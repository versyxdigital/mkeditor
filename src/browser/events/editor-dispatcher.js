import EventDispatcher from './event-dispatcher';

export default class EditorDispatcher extends EventDispatcher {
    message ({ message }) {
        this.dispatchEvent({
            type: 'message',
            message
        });
    };

    setState ({ content }) {
        this.dispatchEvent({
            type: 'editor:state',
            message: content
        });
    }
}
