'use strict';

import _             from 'underscore';
import TyphonEvents  from 'typhonjs-core-backbone-common/src/TyphonEvents.js';
import Queue         from 'typhonjs-core-socket/src/core/Queue.js';
import Socket        from 'typhonjs-core-socket/src/core/Socket.js';

const s_DDP_VERSION = '1';

const s_RECONNECT_INTERVAL = 10000;

const s_STR_EVENT_ADDED = 'ddp:added';
const s_STR_EVENT_CHANGED = 'ddp:changed';
const s_STR_EVENT_CONNECTED = 'ddp:connected';
const s_STR_EVENT_DISCONNECTED = 'ddp:disconnected';
const s_STR_EVENT_ERROR = 'ddp:error';
const s_STR_EVENT_NOSUB = 'ddp:sub:nosub:';
const s_STR_EVENT_READY = 'ddp:sub:ready:';
const s_STR_EVENT_REMOVED = 'ddp:removed';
const s_STR_EVENT_RESULT = 'ddp:result';
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
    */
   constructor(socketOptions)
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

      /**
       * Defines the socket.
       * @type {Object}
       */
      this.socket = new Socket(socketOptions).connect();

      this._params = { socketOptions };

      this._init();
   }

   /**
    * Connects the socket connection.
    *
    * Note: A connection is automatically attempted on construction of DDP.
    */
   connect()
   {
      this.socket.connect.bind(this.socket);
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

         // Schedule a reconnection
         setTimeout(this.socket.connect.bind(this.socket), s_RECONNECT_INTERVAL);
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
               super.triggerDefer(s_STR_EVENT_CONNECTED);
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
               super.triggerDefer(s_STR_EVENT_RESULT, message);
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
    * @param {object}   params - optional parameters
    * @returns {string}
    */
   method(name, params)
   {
      const id = s_UNIQUE_ID();

      this.messageQueue.push({ msg: 'method', id, name, params });

      return id;
   }

   /**
    * Sends a subscription request.
    *
    * @param {string}   name - name of subscription
    * @param {object}   params - optional parameters
    * @returns {Promise}
    */
   sub(name, params)
   {
      const id = s_UNIQUE_ID();

      const promise = new Promise((resolve, reject) =>
      {
         this.once(`${s_STR_EVENT_READY}${id}`, (msg) =>
         {
            this.off(`${s_STR_EVENT_NOSUB}${id}`, this);
            resolve(msg);
         }, this);

         this.once(`${s_STR_EVENT_NOSUB}${id}`, (msg) =>
         {
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
    * @returns {Promise}
    */
   unsub(id)
   {
      const promise = new Promise((resolve) =>
      {
         this.once(`${s_STR_EVENT_NOSUB}${id}`, (msg) =>
         {
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