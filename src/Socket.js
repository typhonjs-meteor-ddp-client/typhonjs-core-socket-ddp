import TyphonEvents from 'backbone-common/src/TyphonEvents.js';

export default class Socket extends TyphonEvents
{
   constructor(SocketConstructor, endpoint)
   {
      super();
      this.SocketConstructor = SocketConstructor;
      this.endpoint = endpoint;
   }

   /**
    * The `open`, `error` and `close` events are simply proxy-ed to `_socket`. The `message` event is instead parsed
    * into a js object (if possible) and then passed as a parameter of the `message:in` event.
    *
    * @returns {Socket}
    */
   connect()
   {
      this.rawSocket = new this.SocketConstructor(this.endpoint);

      this.rawSocket.onopen = () => { super.triggerDefer('open'); };
      this.rawSocket.onerror = (error) => { super.triggerDefer('error', error); };
      this.rawSocket.onclose = () => { super.triggerDefer('close'); };
      this.rawSocket.onmessage = (message) =>
      {
         let object;

         try { object = JSON.parse(message.data); }
         catch(ignore) { return; /* ignore */ }

         // Outside the try-catch block as it must only catch JSON parsing
         // errors, not errors that may occur inside a `message:in` event handler.
         super.triggerDefer('message:in', object);
      };

      return this;
   }

   send(object)
   {
      const message = JSON.stringify(object);

      this.rawSocket.send(message);

      // Emit a copy of the object, as the listener might mutate it.
      super.triggerDefer('message:out', JSON.parse(message));

      return this;
   }
}