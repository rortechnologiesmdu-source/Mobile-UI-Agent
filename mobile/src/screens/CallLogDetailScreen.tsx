import React from 'react';
import EventListScreen from './EventListScreen';

export default function CallLogDetailScreen() {
  return (
    <EventListScreen source="call_log" sinceHours={48} limit={10} emptyLabel="No calls in the last 2 days." />
  );
}
