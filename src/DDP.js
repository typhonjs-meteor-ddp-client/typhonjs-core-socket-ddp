'use strict';

import _             from 'underscore';
import TyphonEvents  from 'typhonjs-core-backbone-events/src/TyphonEvents.js';
import Queue         from 'typhonjs-core-socket/src/Queue.js';
import Socket        from 'typhonjs-core-socket/src/Socket.js';

const s_DDP_VERSION = '1';
const s_TIMEOUT = 10000;      // 10000 milliseconds

const s_STR_EVENT_ADDED = 'ddp:added';
const s_STR_EVENT_CHANGED = 'ddp:changed';
const s_STR_EVENT_CONNECTED = 'ddp:connected';
const s_STR_EVENT_DISCONNECTED = 'ddp:disconnected';
const s_STR_EVENT_ERROR = 'ddp:error';
const s_STR_EVENT_NOSUB = 'ddp:sub:nosub:';
const s_STR_EVENT_READY = 'ddp:sub:ready:';
const s_STR_EVENT_REMOVED = 'ddp:removed';
const s_STR_EVENT_RESULT = 'ddp:result:';
const s_STR_EVENT_UPDATED = 'ddp:updated';

/**
 * Provides a client side implementation of the DDP (Distributed Data Protocol) which is used by Meteor.
 *
 * @see https://www.meteor.com/ddp
 * @see https://github.com/meteor/meteor/blob/devel/packages/ddp/DDP.md
 */
export default class DDP extends TyphonEvents
{
   /**
    * Returns the socket options used by DDP.
    *
    * @returns {Object}
    */
   get socketOptions() { return this._params.socketOptions; }

   /**
    * Instantiates the DDP protocol handler.
    *
    * @param {object}   socketOptions - Object hash that is defined by typhonjs-core-socket -> setSocketOptions
    * (string)   host - host name / port.
    * (boolean)  ssl - (optional) Indicates if an SSL connection is requested; default (false).
    * (object)   serializer - (optional) An instance of an object which conforms to JSON for serialization; default (JSON).
    * (boolean)  autoConnect - (optional) Indicates if socket should connect on construction; default (true).
    * (boolean)  autoReconnect - (optional) Indicates if socket should reconnect on socket closed; default (true).
    * (integer)  reconnectInterval - (optional) Indicates socket reconnect inteveral; default (10000) milliseconds.
    */
   constructor(socketOptions = {})
   {
      super();

      /**
       * Defines the current connection status.
       * @type {string}
       */
      this.status = 'disconnected';

      /**
       * Defines the queue to buffer messages.
       * @type {Object}
       */
      this.messageQueue = new Queue((message) =>
      {
         if (this.status === 'connected') { this.socket.send(message); return true; }
         else { return false; }
      });

      this._params =
      {
         socketOptions
      };

      /**
       * Defines the socket.
       * @type {Object}
       */
      this.socket = new Socket(socketOptions);

      this._init();
   }

   /**
    * Connects the socket connection.
    *
    * Note: A connection is automatically attempted on construction of DDP.
    */
   connect()
   {
      this.socket.connect();
   }

   /**
    * Disconnects the socket connection.
    */
   disconnect()
   {
      this.socket.disconnect(...arguments);

      this.status = 'disconnected';

      this.messageQueue.empty();
      super.triggerDefer(s_STR_EVENT_DISCONNECTED, this.socketOptions);
   }

   /**
    * Initializes all Socket callbacks.
    *
    * @private
    */
   _init()
   {
      // When the socket opens, send the `connect` message to establish the DDP connection.
      this.socket.on('socket:open', () =>
      {
         this.socket.send({ msg: 'connect', version: s_DDP_VERSION, support: [s_DDP_VERSION] });
      });

      this.socket.on('socket:close', () =>
      {
         this.status = 'disconnected';
         this.messageQueue.empty();
         super.triggerDefer(s_STR_EVENT_DISCONNECTED, this.socketOptions);
      });

      this.socket.on('socket:message:in', (message) =>
      {
         switch (message.msg)
         {
            case 'added':
               super.triggerDefer(s_STR_EVENT_ADDED, message);
               break;

            case 'changed':
               super.triggerDefer(s_STR_EVENT_CHANGED, message);
               break;

            case 'connected':
               this.status = 'connected';
               this.messageQueue.process();
               super.triggerDefer(s_STR_EVENT_CONNECTED, this.socketOptions);
               break;

            case 'error':
               super.triggerDefer(s_STR_EVENT_ERROR, message);
               break;

            case 'nosub':
               // Send specific `nosub` events with the subscription `id`.
               if (message.id) { super.triggerDefer(`${s_STR_EVENT_NOSUB}${message.id}`, message); }
               break;

            // Reply with a `pong` message to prevent the server from closing the connection.
            case 'ping':
               this.socket.send({ msg: 'pong', id: message.id });
               break;

            // Subscriptions
            case 'ready':
               // Send specific `ready` events with the subscription `id`.
               if (Array.isArray(message.subs))
               {
                  message.subs.forEach((id) =>
                  {
                     super.triggerDefer(`${s_STR_EVENT_READY}${id}`, _.extend({ activeId: id }, message));
                  });
               }
               break;

            case 'removed':
               super.triggerDefer(s_STR_EVENT_REMOVED, message);
               break;

            case 'result':
               super.triggerDefer(`${s_STR_EVENT_RESULT}${message.id}`, message);
               break;

            case 'updated':
               super.triggerDefer(s_STR_EVENT_UPDATED, message);
               break;
         }
      });
   }

   /**
    * Invokes a remote method on the server.
    *
    * @param {string}   name - name of method
    * @param {Array<*>} params - optional array of EJSON items (parameters to the method)
    * @param {number}   timeout - optional timeout in milliseconds (default 10000)
    * @param {object}   randomSeed - optional JSON value (an arbitrary client-determined seed for pseudo-random
    *                                generators)
    * @returns {Promise}
    */
   method(name, params, timeout = s_TIMEOUT, randomSeed)
   {
      const id = s_UNIQUE_ID();

      const promise = new Promise((resolve, reject) =>
      {
         // Provides a time out to reject request and unregister listeners.
         const timer = setTimeout(() =>
         {
            this.off(`${s_STR_EVENT_RESULT}${id}`, this);
            reject(`method - id: ${id}; name: ${name} timed out.`);
         }, timeout);

         this.once(`${s_STR_EVENT_RESULT}${id}`, (msg) =>
         {
            clearTimeout(timer);
            _.isUndefined(msg.error) ? resolve(msg) : reject(msg);
         }, this);
      });

      this.messageQueue.push({ msg: 'method', id, method: name, params, randomSeed });

      return promise;
   }

   /**
    * Sends a subscription request.
    *
    * @param {string}   name - name of subscription
    * @param {object}   params - optional parameters
    * @param {number}   timeout - optional timeout in milliseconds (default 10000)
    * @returns {Promise}
    */
   sub(name, params, timeout = s_TIMEOUT)
   {
      const id = s_UNIQUE_ID();

      const promise = new Promise((resolve, reject) =>
      {
         // Provides a time out to reject request and unregister listeners.
         const timer = setTimeout(() =>
         {
            this.off(`${s_STR_EVENT_NOSUB}${id}`, this);
            this.off(`${s_STR_EVENT_READY}${id}`, this);
            reject(`sub - id: ${id}; name: ${name} timed out.`);
         }, timeout);

         this.once(`${s_STR_EVENT_READY}${id}`, (msg) =>
         {
            clearTimeout(timer);
            this.off(`${s_STR_EVENT_NOSUB}${id}`, this);
            resolve(msg);
         }, this);

         this.once(`${s_STR_EVENT_NOSUB}${id}`, (msg) =>
         {
            clearTimeout(timer);
            this.off(`${s_STR_EVENT_READY}${id}`, this);
            reject(msg);
         }, this);
      });

      this.messageQueue.push({ msg: 'sub', id, name, params });

      return promise;
   }

   /**
    * Sends a unsubscribe request.
    *
    * @param {string}   id - id of subscription
    * @param {number}   timeout - optional timeout in milliseconds (default 10000)
    * @returns {Promise}
    */
   unsub(id, timeout = s_TIMEOUT)
   {
      const promise = new Promise((resolve, reject) =>
      {
         // Provides a time out to reject request and unregister listeners.
         const timer = setTimeout(() =>
         {
            this.off(`${s_STR_EVENT_NOSUB}${id}`, this);
            reject(`unsub - id: ${id} timed out.`);
         }, timeout);

         this.once(`${s_STR_EVENT_NOSUB}${id}`, (msg) =>
         {
            clearTimeout(timer);
            resolve(msg);
         }, this);
      });

      this.messageQueue.push({ msg: 'unsub', id });

      return promise;
   }
}

// Private Utility Methods ------------------------------------------------------------------------------------------

let uniqueID = 0;

/**
 * Returns a unique ID.
 *
 * @returns {string}
 */
const s_UNIQUE_ID = () => { return (uniqueID++).toString(); };