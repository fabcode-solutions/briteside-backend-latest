import {
  SNSClient,
  PublishCommand,
  CreateTopicCommand,
  SubscribeCommand,
  DeleteTopicCommand,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns';

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

export const sendSMS = async (phoneNumber, message) => {
  const result = await snsClient.send(
    new PublishCommand({ Message: message, PhoneNumber: phoneNumber })
  );
  return result;
};

export const createEventTopic = async (eventId, title = '') => {
  const safeName = title
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 256);
  const topicName = safeName || `Event-${eventId}`;
  const { TopicArn } = await snsClient.send(new CreateTopicCommand({ Name: topicName }));
  return TopicArn;
};

export const subscribeToEvent = async (topicArn, phoneNumber) => {
  const { SubscriptionArn } = await snsClient.send(
    new SubscribeCommand({ TopicArn: topicArn, Protocol: 'sms', Endpoint: phoneNumber })
  );
  return SubscriptionArn;
};

export const sendEventBlast = async (topicArn, message) => {
  const { MessageId } = await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: `Alert: ${message}`,
    })
  );
  return MessageId;
};

export const unsubscribeFromEvent = async subscriptionArn => {
  await snsClient.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
};

export const deleteEventTopic = async topicArn => {
  await snsClient.send(new DeleteTopicCommand({ TopicArn: topicArn }));
};

// SMS subscriptions are auto-confirmed (no email-style confirmation needed).
// Users can opt out by replying "STOP" — SNS handles this automatically.
export const subscribeWithRetry = async (topicArn, phoneNumber, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await subscribeToEvent(topicArn, phoneNumber);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};
