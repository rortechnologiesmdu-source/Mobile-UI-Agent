import React from 'react';
import EventListScreen from './EventListScreen';

export default function SmsDetailScreen() {
  return <EventListScreen source="sms" sinceHours={120} limit={100} emptyLabel="No SMS in the last 5 days." />;
}
