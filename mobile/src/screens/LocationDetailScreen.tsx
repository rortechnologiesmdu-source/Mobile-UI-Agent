import React from 'react';
import EventListScreen from './EventListScreen';

export default function LocationDetailScreen() {
  return (
    <EventListScreen
      source="location"
      sinceHours={48}
      emptyLabel="No location snapshot yet — this fills in on the next background sync (every ~15 min) once location permission is granted."
    />
  );
}
