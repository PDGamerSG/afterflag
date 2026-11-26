export const decoders = {
  json(bytes) {
    const { subscriber, event } = JSON.parse(bytes.toString());
    if (typeof subscriber !== 'string' || typeof event?.type !== 'string') throw new Error('Invalid delivery intent.');
    return subscriber + ':' + event.type;
  }
};
