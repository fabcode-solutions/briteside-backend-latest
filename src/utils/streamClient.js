import { StreamClient } from '@stream-io/node-sdk';

const apiKey = process.env.STREAM_API_KEY;
const secret = process.env.STREAM_API_SECRET;
export const streamClient = new StreamClient(apiKey, secret);
