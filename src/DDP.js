import TyphonEvents  from 'backbone-common/src/TyphonEvents.js';
import Queue         from './Queue.js';
import Socket        from './Socket.js';

const DDP_VERSION = '1';

const RECONNECT_INTERVAL = 10000;

export default class DDP extends TyphonEvents
{
   triggerDefer()
   {
      const args = arguments;
      setTimeout(() =>
      {
         super.trigger.apply(this, args);
      }, 0);
   }

   constructor(options)
   {
      super();

      this.status = 'disconnected';

      this.messageQueue = new Queue((message) =>
      {
         if (this.status === 'connected')
         {
            this.socket.send(message);
            return true;
         }
         else
         {
            return false;
         }
      });

      this.socket = new Socket(options.SocketConstructor, options.endpoint);

      this.socket.on('open', () =>
      {
         // When the socket opens, send the `connect` message
         // to establish the DDP connection
         this.socket.send(
         {
            msg: 'connect',
            version: DDP_VERSION,
            support: [DDP_VERSION]
         });
      });

      this.socket.on('close', () =>
      {
         this.status = 'disconnected';
         this.messageQueue.empty();
         this.triggerDefer('disconnected');

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
               this.triggerDefer('connected');
               break;

            // Reply with a `pong` message to prevent the server from closing the connection.
            case 'ping':
               this.socket.send({ msg: 'pong', id: message.id });
               break;

            case 'error':
            case 'result':
            case 'updated':
               this.triggerDefer(message.msg, message);
               break;

            // Subscriptions
            case 'ready':
               if (Array.isArray(message.subs))
               {
                  message.subs.forEach((sub) =>
                  {
                     this.triggerDefer(`sub:${message.msg}:${sub}`, message);
                  });
               }
               break;
            case 'nosub':
            case 'added':
            case 'changed':
            case 'removed':
               this.triggerDefer(message.msg, message);
               break;
         }
      });

      this.socket.connect();
   }

   method(name, params)
   {
      const id = s_UNIQUE_ID();

      this.messageQueue.push(
      {
         msg: 'method',
         id,
         name,
         params
      });

      return id;
   }

   sub(name, params)
   {
      const id = s_UNIQUE_ID();

      this.messageQueue.push(
      {
         msg: 'sub',
         id,
         name,
         params
      });

      return id;
   }

   unsub(id)
   {
      this.messageQueue.push(
      {
         msg: 'unsub',
         id
      });

      return id;
   }
}

let uniqueID = 0;

const s_UNIQUE_ID = () =>
{
   return (uniqueID++).toString();
};