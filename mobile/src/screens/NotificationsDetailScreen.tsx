import React from 'react';
import EventListScreen from './EventListScreen';

export default function NotificationsDetailScreen() {
  return (
    <EventListScreen
      source="notification"
      sinceHours={24 * 30}
      limit={10}
      emptyLabel="No notifications yet."
      pollIntervalMs={5000}
    />
  );
}
