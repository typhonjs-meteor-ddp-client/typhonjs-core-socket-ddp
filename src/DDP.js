import _             from 'underscore';
import TyphonEvents  from 'backbone-common/src/TyphonEvents.js';
import Queue         from './Queue.js';
import Socket        from './Socket.js';

const DDP_VERSION = '1';

const RECONNECT_INTERVAL = 10000;

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

export default class DDP extends TyphonEvents
{
   constructor(options)
   {
      super();

      this.status = 'disconnected';

      this.messageQueue = new Queue((message) =>
      {
         if (this.status === 'connected') { this.socket.send(message); return true; }
         else { return false; }
      });

      this.socket = new Socket(options.SocketConstructor, options.endpoint).connect();

      this._init();
   }

   _init()
   {
      // When the socket opens, send the `connect` message to establish the DDP connection.
      this.socket.on('socket:open', () =>
      {
         this.socket.send({ msg: 'connect', version: DDP_VERSION, support: [DDP_VERSION] });
      });

      this.socket.on('socket:close', () =>
      {
         this.status = 'disconnected';
         this.messageQueue.empty();
         super.triggerDefer(s_STR_EVENT_DISCONNECTED);

         // Schedule a reconnection
         setTimeout(this.socket.connect.bind(this.socket), RECONNECT_INTERVAL);
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
                  message.subs.forEach((id) => { super.triggerDefer(`${s_STR_EVENT_READY}${id}`,
                   _.extend({ activeId: id }, message)); });
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

   method(name, params)
   {
      const id = s_UNIQUE_ID();

      this.messageQueue.push({ msg: 'method', id, name, params });

      return id;
   }

   sub(name, params)
   {
      const id = s_UNIQUE_ID();

      this.messageQueue.push({ msg: 'sub', id, name, params });

      return new Promise((resolve, reject) =>
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
   }

   unsub(id)
   {
      this.messageQueue.push({ msg: 'unsub', id });

      return id;
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