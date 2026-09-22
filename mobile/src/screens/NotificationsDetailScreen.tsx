import React from 'react';
import EventListScreen from './EventListScreen';

export default function NotificationsDetailScreen() {
  return (
    <EventListScreen
      source="notification"
      sinceHours={48}
      limit={100}
      emptyLabel="No notifications in the last 2 days."
      pollIntervalMs={5000}
    />
  );
}
