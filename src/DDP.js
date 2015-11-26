import TyphonEvents  from 'backbone-common/src/TyphonEvents.js';
import Queue         from './Queue.js';
import Socket        from './Socket.js';

const DDP_VERSION = '1';

const RECONNECT_INTERVAL = 10000;

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
      this.socket.on('open', () =>
      {
         this.socket.send({ msg: 'connect', version: DDP_VERSION, support: [DDP_VERSION] });
      });

      this.socket.on('close', () =>
      {
         this.status = 'disconnected';
         this.messageQueue.empty();
         super.triggerDefer('disconnected');

         // Schedule a reconnection
         setTimeout(this.socket.connect.bind(this.socket), RECONNECT_INTERVAL);
      });

      this.socket.on('message:in', (message) =>
      {
         switch (message.msg)
         {
            case 'connected':
               this.status = 'connected';
               this.messageQueue.process();
               super.triggerDefer('connected');
               break;

            // Reply with a `pong` message to prevent the server from closing the connection.
            case 'ping':
               this.socket.send({ msg: 'pong', id: message.id });
               break;

            case 'error':
            case 'result':
            case 'updated':
               super.triggerDefer(message.msg, message);
               break;

            // Subscriptions
            case 'ready':
               // Send specific `ready` events with the subscription `id`.
               if (Array.isArray(message.subs))
               {
                  message.subs.forEach((id) => { super.triggerDefer(`sub:${message.msg}:${id}`, message); });
               }
               break;
            case 'nosub':
            case 'added':
            case 'changed':
            case 'removed':
               super.triggerDefer(message.msg, message);
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

      return id;
   }

   triggerDefer()
   {
      setTimeout(() => { super.trigger(this, ...arguments); }, 0);
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