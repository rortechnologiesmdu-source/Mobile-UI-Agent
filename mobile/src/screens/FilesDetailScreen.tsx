import React from 'react';
import EventListScreen from './EventListScreen';

export default function FilesDetailScreen() {
  return (
    <EventListScreen
      source="file"
      sinceHours={168}
      limit={5}
      emptyLabel="No new photos in the last week."
    />
  );
}
