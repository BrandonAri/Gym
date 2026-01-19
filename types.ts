export type Unit = 'kg' | 'lbs';

export interface Set {
  id: string;
  weight: number;
  reps: number;
  completed: boolean;
}

export interface ExerciseDef {
  id: string;
  name: string;
  description: string;
  mediaUrl?: string; // Legacy/External URL
  mediaId?: string;  // Reference to IndexedDB Blob
  mediaType?: 'image' | 'video';
}

export interface ExerciseInstance {
  id: string;
  defId: string; // References ExerciseDef.id
  sets: Set[];
}

export interface Workout {
  id: string;
  date: string; // ISO Date String YYYY-MM-DD
  title: string;
  note: string;
  exercises: ExerciseInstance[];
  completed: boolean;
  // Timer fields
  elapsedSeconds: number; 
  startTimestamp: number | null; // Date.now() when started, null if paused
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  preferences: {
    defaultUnit: Unit;
  };
}