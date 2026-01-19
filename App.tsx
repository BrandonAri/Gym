import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { 
  Home, Calendar as CalendarIcon, History, User, Plus, 
  ChevronRight, Save, Trash2, Camera, Check, Dumbbell, 
  Copy, ArrowLeft, MoreVertical, X, Menu, Filter,
  Play, Pause, RotateCcw, BarChart3, Clock, ChevronLeft, MoreHorizontal, Loader2
} from 'lucide-react';
import { Button, Modal, Input, useLongPress, MediaResolver, useSwipe, SwipeableItem } from './components/ui';
import { generateId, formatDate, getDisplayDate, processAndSaveMedia, getDayNumber, getMonthName, formatDuration, getMediaFromDB } from './services/utils';
import { ExerciseDef, ExerciseInstance, UserProfile, Workout, Set } from './types';
import { supabase, uploadMediaToSupabase } from './services/supabase';

// --- Context ---

interface GymContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  toggleUnit: () => void;
  workouts: Workout[];
  exerciseDefs: ExerciseDef[];
  addWorkout: (workout: Workout) => void;
  updateWorkout: (workout: Workout) => void;
  deleteWorkout: (id: string) => void;
  addExerciseDef: (def: ExerciseDef) => void;
  copyWorkout: (workoutId: string, targetDate: string) => void;
}

const GymContext = createContext<GymContextType>({} as GymContextType);

const INITIAL_EXERCISES: ExerciseDef[] = [
  { id: '1', name: 'Bench Press', description: 'Barbell bench press', mediaType: 'image' },
  { id: '2', name: 'Squat', description: 'Barbell back squat', mediaType: 'image' },
  { id: '3', name: 'Deadlift', description: 'Conventional deadlift', mediaType: 'image' },
];

const GymProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [exerciseDefs, setExerciseDefs] = useState<ExerciseDef[]>(INITIAL_EXERCISES);
  const [isLoading, setIsLoading] = useState(true);

  // --- Auth & Initial Load ---
  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        mapUser(session.user);
        fetchData();
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        mapUser(session.user);
        fetchData();
        
        // FIX: If we are using HashRouter, the OAuth redirect hash (#access_token=...) 
        // can confuse the router and cause a blank screen. We clean it here if user is found.
        if (window.location.hash && window.location.hash.includes('access_token')) {
            window.location.hash = ''; 
        }
      } else {
        setUser(null);
        setWorkouts([]);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const mapUser = (authUser: any) => {
      setUser({
          id: authUser.id,
          name: authUser.user_metadata.full_name || authUser.email?.split('@')[0] || 'User',
          email: authUser.email || '',
          photoUrl: authUser.user_metadata.avatar_url || `https://ui-avatars.com/api/?name=${authUser.email}&background=0D8ABC&color=fff`,
          preferences: { defaultUnit: 'lbs' } // Could sync prefs to a 'profiles' table later
      });
  };

  const fetchData = async () => {
      setIsLoading(true);
      try {
          // Fetch Workouts
          const { data: wData, error: wError } = await supabase.from('workouts').select('*');
          if (wData) {
              const parsedWorkouts = wData.map((row: any) => ({
                  id: row.id,
                  date: row.date,
                  title: row.title,
                  completed: row.completed,
                  ...row.data // Spread the JSON content (exercises, note, timers)
              }));
              setWorkouts(parsedWorkouts);
          }

          // Fetch Exercises
          const { data: eData, error: eError } = await supabase.from('exercise_defs').select('*');
          if (eData && eData.length > 0) {
              const parsedDefs = eData.map((row: any) => ({
                  id: row.id,
                  name: row.name,
                  description: row.description,
                  mediaUrl: row.media_url,
                  mediaType: row.media_type,
                  ...row.data
              }));
              setExerciseDefs(parsedDefs);
          }
      } catch (e) {
          console.error("Sync Error:", e);
      } finally {
          setIsLoading(false);
      }
  };

  const login = async () => {
    // Explicitly using window.location.origin to ensure redirect goes back to the correct environment (cloud/local)
    // IMPORTANT: Add this URL to your Supabase Dashboard -> Authentication -> URL Configuration -> Redirect URLs
    let redirectUrl = window.location.origin;
    
    // Remove trailing slash if present (common in some environments) to ensure cleaner matching in Supabase
    if (redirectUrl.endsWith('/')) {
        redirectUrl = redirectUrl.slice(0, -1);
    }
    
    console.log("Logging in with redirect URL:", redirectUrl);
    
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectUrl
        }
    });
    if (error) alert("Login failed: " + error.message);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const toggleUnit = () => {
    if (!user) return;
    const newUnit = user.preferences.defaultUnit === 'kg' ? 'lbs' : 'kg';
    setUser({ ...user, preferences: { ...user.preferences, defaultUnit: newUnit } });
  };

  // --- Database Operations ---

  const addWorkout = async (workout: Workout) => {
    // Optimistic Update
    setWorkouts(prev => [...prev, workout]);
    
    if (user) {
        const row = {
            id: workout.id,
            user_id: user.id,
            date: workout.date,
            title: workout.title,
            completed: workout.completed,
            data: {
                exercises: workout.exercises,
                note: workout.note,
                elapsedSeconds: workout.elapsedSeconds,
                startTimestamp: workout.startTimestamp
            }
        };
        await supabase.from('workouts').upsert(row);
    }
  };

  const updateWorkout = async (updated: Workout) => {
    // Optimistic
    setWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w));

    if (user) {
         const row = {
            id: updated.id,
            user_id: user.id,
            date: updated.date,
            title: updated.title,
            completed: updated.completed,
            data: {
                exercises: updated.exercises,
                note: updated.note,
                elapsedSeconds: updated.elapsedSeconds,
                startTimestamp: updated.startTimestamp
            }
        };
        await supabase.from('workouts').upsert(row);
    }
  };

  const deleteWorkout = async (id: string) => {
    setWorkouts(prev => prev.filter(w => w.id !== id));
    if (user) {
        await supabase.from('workouts').delete().eq('id', id);
    }
  };

  const addExerciseDef = async (def: ExerciseDef) => {
    setExerciseDefs(prev => [...prev, def]);
    if (user) {
        const row = {
            id: def.id,
            user_id: user.id,
            name: def.name,
            description: def.description,
            media_url: def.mediaUrl,
            media_type: def.mediaType,
            data: {} 
        };
        await supabase.from('exercise_defs').upsert(row);
    }
  };

  const copyWorkout = (workoutId: string, targetDate: string) => {
    const source = workouts.find(w => w.id === workoutId);
    if (!source) return;

    const newWorkout: Workout = {
      ...source,
      id: generateId(),
      date: targetDate,
      completed: false,
      elapsedSeconds: 0,
      startTimestamp: null,
      exercises: source.exercises.map(ex => ({
        ...ex,
        sets: ex.sets.map(s => ({ ...s, completed: false }))
      }))
    };
    addWorkout(newWorkout);
  };

  return (
    <GymContext.Provider value={{
      user, isLoading, login, logout, toggleUnit, workouts, exerciseDefs,
      addWorkout, updateWorkout, deleteWorkout, addExerciseDef, copyWorkout
    }}>
      {children}
    </GymContext.Provider>
  );
};

// --- Views ---

const LoginView: React.FC = () => {
  const { login, isLoading } = useContext(GymContext);
  
  if (isLoading) {
      return (
          <div className="h-screen flex items-center justify-center bg-white">
              <Loader2 className="animate-spin text-cyan-400" size={48} />
          </div>
      )
  }

  return (
    <div className="h-screen flex flex-col justify-between bg-white px-8 py-12 animate-in fade-in duration-700">
      <div className="mt-20">
         <h1 className="text-5xl font-black text-center leading-tight tracking-tight text-gray-900">
            Start tracking<br/>your first<br/>workout...
         </h1>
      </div>

      <div className="flex flex-col items-center w-full">
         <div className="mb-10 w-full flex flex-col items-center">
            <div className="flex gap-2 justify-center mb-6">
               <div className="flex items-center text-cyan-400">
                  <User size={32} />
                  <User size={32} className="-ml-2 opacity-60" />
               </div>
            </div>
            <p className="text-xs text-gray-400 text-center leading-relaxed max-w-xs mx-auto">
               Gym Tracker use your Google account to sign-in. Your data is securely synced to the cloud.
            </p>
         </div>
         
         <button 
           onClick={login}
           className="w-full bg-cyan-400 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-cyan-100 active:scale-95 transition-all hover:bg-cyan-500"
         >
           Continue with Google
         </button>
      </div>
    </div>
  );
};

// ... [Dashboard, HistoryView, CalendarView, ProfileView remain mostly the same, just receiving updated Context]

const Dashboard: React.FC = () => {
  const { workouts, copyWorkout, isLoading } = useContext(GymContext);
  const navigate = useNavigate();
  const today = formatDate(new Date());

  const todaysActiveWorkouts = workouts.filter(w => w.date === today && !w.completed);
  
  const lastWorkout = useMemo(() => {
    return workouts
      .filter(w => w.date < today && w.completed) 
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [workouts, today]);

  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState(today);

  const handleWorkoutClick = (id: string) => {
    navigate(`/workout/${id}`);
  };

  const handleCopyRequest = (id: string) => {
    setSelectedWorkoutId(id);
    setCopyModalOpen(true);
  };

  const confirmCopy = () => {
    if (selectedWorkoutId) {
      copyWorkout(selectedWorkoutId, targetDate);
      setCopyModalOpen(false);
    }
  };

  const WorkoutCard: React.FC<{ workout: Workout, label?: string, isMain?: boolean, style?: React.CSSProperties, onClick?: () => void }> = ({ 
    workout, label, isMain, style, onClick 
  }) => {
    const longPress = useLongPress(
      () => handleCopyRequest(workout.id),
      () => onClick ? onClick() : handleWorkoutClick(workout.id)
    );
    
    const bgClass = isMain 
      ? "bg-gradient-to-br from-lime-300 to-teal-500 text-white shadow-emerald-100/50"
      : "bg-white border border-gray-100 text-gray-800 shadow-gray-100";

    const textClass = isMain ? "text-white" : "text-gray-900";
    const subTextClass = isMain ? "text-teal-50" : "text-gray-400";

    return (
        <div 
          {...longPress} 
          style={style}
          className={`relative rounded-[32px] p-6 shadow-xl w-full h-56 flex flex-col justify-between cursor-pointer active:scale-[0.98] transition-all overflow-hidden ${bgClass}`}
        >
          <div className="z-10 relative h-full flex flex-col">
            <div className="flex items-center gap-2 mb-2">
                <Dumbbell className={isMain ? "opacity-70" : "text-indigo-500"} size={18} />
                {label && <span className={`text-xs font-bold tracking-widest uppercase opacity-70`}>{label}</span>}
            </div>
            
            <h3 className={`text-3xl font-bold uppercase leading-9 tracking-tight max-w-[70%] ${textClass}`}>
              {workout.title}
            </h3>

            <div className="mt-auto">
               <p className={`text-sm font-medium leading-snug max-w-[60%] ${subTextClass}`}>
                 {workout.note || "No notes for this workout."}
               </p>
               {workout.startTimestamp && (
                   <div className="mt-2 flex items-center gap-1 text-xs font-bold bg-black/20 w-fit px-2 py-1 rounded-lg animate-pulse">
                      <Clock size={12}/> IN PROGRESS
                   </div>
               )}
            </div>
          </div>

          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none">
              <span className={`text-8xl font-light tracking-tighter ${textClass}`}>
                {getDayNumber(workout.date)}
              </span>
              <span className={`text-xl font-medium -mt-2 ${subTextClass}`}>
                {getMonthName(workout.date)}
              </span>
          </div>
        </div>
    );
  };

  const [topCardIndex, setTopCardIndex] = useState(0);

  const stackSwipeHandlers = useSwipe({
      onSwipeUp: () => {
          if (todaysActiveWorkouts.length > 1) {
              setTopCardIndex(prev => (prev + 1) % todaysActiveWorkouts.length);
          }
      },
      onSwipeDown: () => {
          if (todaysActiveWorkouts.length > 1) {
              setTopCardIndex(prev => (prev - 1 + todaysActiveWorkouts.length) % todaysActiveWorkouts.length);
          }
      }
  });

  if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-gray-300"/></div>;

  return (
    <div className="px-6 pt-8 pb-32 min-h-screen bg-white">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-black text-gray-900 tracking-tight">Workout</h1>
        <button className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 active:bg-gray-200">
           <Menu size={20} />
        </button>
      </header>

      <div className="relative min-h-[240px]" {...stackSwipeHandlers}>
        {todaysActiveWorkouts.length > 0 ? (
          <div className="relative w-full h-56">
             {todaysActiveWorkouts.map((workout, index) => {
                 const isTop = index === topCardIndex;
                 if (!isTop) {
                    return (
                        <div 
                           key={workout.id}
                           className="absolute top-0 w-full h-56 rounded-[32px] bg-teal-50 border-2 border-white shadow-lg transition-all duration-500 ease-in-out"
                           style={{ 
                               zIndex: 0, 
                               transform: `scale(0.9) translateY(15px)`,
                               opacity: 0.6
                           }}
                        >
                           <div className="p-6 opacity-0">Placeholder</div>
                        </div>
                    );
                 }
                 
                 return (
                     <div key={workout.id} className="absolute top-0 w-full z-40 transition-all duration-500">
                        <WorkoutCard 
                            workout={workout} 
                            label={`Today's Plan ${todaysActiveWorkouts.length > 1 ? `(${index + 1}/${todaysActiveWorkouts.length})` : ''}`} 
                            isMain={true} 
                            onClick={() => handleWorkoutClick(workout.id)}
                        />
                        {todaysActiveWorkouts.length > 1 && (
                             <div className="absolute right-6 top-6 flex flex-col gap-1 items-end z-50 pointer-events-none">
                                <div className="text-[10px] text-white/50 font-bold uppercase tracking-wider">Swipe Vertical</div>
                             </div>
                        )}
                        {todaysActiveWorkouts.length > 1 && (
                            <div className="absolute -bottom-6 left-0 w-full flex justify-center gap-2">
                                {todaysActiveWorkouts.map((_, i) => (
                                    <div key={i} className={`w-2 h-2 rounded-full ${i === topCardIndex ? 'bg-cyan-500' : 'bg-gray-300'}`} />
                                ))}
                            </div>
                        )}
                     </div>
                 );
             })}
          </div>
        ) : (
          <div className="rounded-[32px] bg-gray-50 p-8 text-center border-2 border-dashed border-gray-200 h-56 flex flex-col items-center justify-center">
             <h3 className="font-bold text-xl text-gray-900 mb-2">Rest Day?</h3>
             <p className="text-gray-500 mb-4 text-sm">No active workout for today.</p>
             <Button onClick={() => navigate('/workout/new')} className="rounded-full px-8">Start Now</Button>
          </div>
        )}
      </div>

      {lastWorkout && (
        <div className="mt-12">
           <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 ml-2">Last Completed</h2>
           <WorkoutCard workout={lastWorkout} />
        </div>
      )}

      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-20">
         <button 
           onClick={() => navigate('/workout/new')}
           className="w-14 h-14 bg-gray-100 text-gray-900 rounded-full shadow-lg shadow-gray-200 flex items-center justify-center hover:bg-gray-200 active:scale-90 transition-all"
         >
           <Plus size={28} />
         </button>
      </div>

      <Modal isOpen={copyModalOpen} onClose={() => setCopyModalOpen(false)} title="Copy Workout">
         <p className="mb-4 text-gray-600">Select a date to schedule this workout:</p>
         <Input 
            type="date" 
            value={targetDate} 
            min={today}
            onChange={(e) => setTargetDate(e.target.value)} 
         />
         <Button className="w-full mb-3" onClick={confirmCopy}>Schedule</Button>
         <Button variant="secondary" className="w-full" onClick={() => setCopyModalOpen(false)}>Cancel</Button>
      </Modal>
    </div>
  );
};

// ... [HistoryView, CalendarView, ProfileView - reusing existing with context]
// Simplified for brevity in this response, but assuming previous code for views is retained
// except `WorkoutEditor` which needs update for Media Upload

const HistoryView = () => {
    // Reusing exact logic from previous turn, just ensuring Context consumption is clean
    const { workouts, copyWorkout, deleteWorkout } = useContext(GymContext);
    const navigate = useNavigate();
    const today = formatDate(new Date());

    // Action Menu State
    const [actionMenuOpen, setActionMenuOpen] = useState(false);
    const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

    // Copy/Delete Modals
    const [copyModalOpen, setCopyModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [targetDate, setTargetDate] = useState(today);

    // Filter State
    const [filterType, setFilterType] = useState<'all'|'year'|'month'|'name'>('all');
    const [filterValue, setFilterValue] = useState<string>('');
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

    const filteredWorkouts = useMemo(() => {
        let list = [...workouts];
        if (filterType === 'name' && filterValue) {
        list = list.filter(w => w.title.toLowerCase().includes(filterValue.toLowerCase()));
        } else if (filterType === 'year' && filterValue) {
        list = list.filter(w => w.date.startsWith(filterValue));
        } else if (filterType === 'month' && filterValue) {
        list = list.filter(w => w.date.startsWith(filterValue));
        }
        return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [workouts, filterType, filterValue]);

    // Handlers
    const handleOpenActionMenu = (id: string) => { setSelectedActionId(id); setActionMenuOpen(true); };
    const handleCopySwipe = (id: string) => { setSelectedActionId(id); setTargetDate(today); setCopyModalOpen(true); };
    const handleDeleteSwipe = (id: string) => { setSelectedActionId(id); setDeleteModalOpen(true); };
    const confirmCopy = () => { if (selectedActionId) { copyWorkout(selectedActionId, targetDate); setCopyModalOpen(false); setSelectedActionId(null); } };
    const confirmDelete = () => { if (selectedActionId) { deleteWorkout(selectedActionId); setDeleteModalOpen(false); setSelectedActionId(null); } };
    const applyFilter = (type: any, value: string) => { setFilterType(type); setFilterValue(value); setIsFilterModalOpen(false); };

    const ActionMenu: React.FC<{ isOpen: boolean, onClose: () => void, onCopy: () => void, onDelete: () => void }> = ({
        isOpen, onClose, onCopy, onDelete
    }) => {
        if (!isOpen) return null;
        return (
            <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in">
                <div className="bg-white rounded-t-[32px] p-6 pb-12 animate-in slide-in-from-bottom duration-300">
                    <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-6"></div>
                    <h3 className="font-bold text-xl text-gray-900 mb-6 text-center">Workout Options</h3>
                    <div className="space-y-3">
                        <Button onClick={() => { onCopy(); onClose(); }} className="w-full bg-cyan-50 text-cyan-600 shadow-none hover:bg-cyan-100 justify-start">
                            <Copy size={20} /> Schedule Copy
                        </Button>
                        <Button onClick={() => { onDelete(); onClose(); }} variant="danger" className="w-full justify-start bg-red-50 text-red-500 shadow-none hover:bg-red-100">
                            <Trash2 size={20} /> Delete Workout
                        </Button>
                        <div className="h-4"></div>
                        <Button onClick={onClose} variant="secondary" className="w-full">Cancel</Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="px-6 pt-8 pb-32 bg-white min-h-screen">
            <header className="flex justify-between items-center mb-8">
                <h1 className="text-4xl font-black text-gray-900 tracking-tight">History</h1>
                <button onClick={() => setIsFilterModalOpen(true)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${filterType !== 'all' ? 'bg-cyan-400 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Filter size={20} />
                </button>
            </header>
            
            {filterType !== 'all' && (
                <div className="flex items-center gap-2 mb-4 bg-gray-50 px-3 py-2 rounded-xl w-fit">
                    <span className="text-xs font-bold text-gray-500 uppercase">{filterType}:</span>
                    <span className="text-sm font-bold text-gray-900">{filterValue}</span>
                    <button onClick={() => applyFilter('all', '')} className="ml-2 bg-gray-200 rounded-full p-1 text-gray-600"><X size={12}/></button>
                </div>
            )}

            <div className="space-y-4">
                {filteredWorkouts.length === 0 ? (
                    <div className="text-center py-20 text-gray-400"><p>No workouts found.</p></div>
                ) : filteredWorkouts.map(workout => (
                    <SwipeableItem key={workout.id} onSwipeRight={() => handleCopySwipe(workout.id)} onSwipeLeft={() => handleDeleteSwipe(workout.id)}>
                        <div {...useLongPress(() => handleOpenActionMenu(workout.id), () => navigate(`/workout/${workout.id}`))} className="bg-white p-5 rounded-3xl shadow-lg shadow-gray-100 border border-gray-50 flex justify-between items-center active:scale-[0.99] transition-transform cursor-pointer select-none">
                            <div className="flex items-center gap-4">
                                <div className="bg-cyan-50 text-cyan-500 w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg">{getDayNumber(workout.date)}</div>
                                <div>
                                    <h3 className="font-bold text-gray-900 text-lg">{workout.title}</h3>
                                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{getMonthName(workout.date)} • {workout.exercises.length} Exercises {workout.completed && <span className="ml-2 text-green-500">✓ Done</span>}</p>
                                </div>
                            </div>
                            <div className={`w-2 h-2 rounded-full ${workout.completed ? 'bg-green-400' : 'bg-orange-300'}`}></div>
                        </div>
                    </SwipeableItem>
                ))}
            </div>

            <ActionMenu isOpen={actionMenuOpen} onClose={() => setActionMenuOpen(false)} onCopy={() => { setTargetDate(today); setCopyModalOpen(true); }} onDelete={() => setDeleteModalOpen(true)} />
            
            <Modal isOpen={copyModalOpen} onClose={() => setCopyModalOpen(false)} title="Copy Workout">
                <p className="mb-4 text-gray-600">Select a date to schedule this workout:</p>
                <Input type="date" value={targetDate} min={today} onChange={(e) => setTargetDate(e.target.value)} />
                <Button className="w-full mb-3" onClick={confirmCopy}>Schedule</Button>
                <Button variant="secondary" className="w-full" onClick={() => setCopyModalOpen(false)}>Cancel</Button>
            </Modal>
            
            <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Workout">
                <div className="text-center">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={32} /></div>
                    <p className="mb-6 text-gray-600">Are you sure you want to delete this workout?</p>
                    <Button variant="danger" className="w-full mb-3" onClick={confirmDelete}>Yes, Delete</Button>
                    <Button variant="secondary" className="w-full" onClick={() => setDeleteModalOpen(false)}>Cancel</Button>
                </div>
            </Modal>
            
            <Modal isOpen={isFilterModalOpen} onClose={() => setIsFilterModalOpen(false)} title="Filter History">
                 {/* Reusing existing filter content */}
                 <div className="flex flex-col gap-4">
                    <div className="space-y-2">
                       <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">By Name</label>
                       <div className="flex gap-2">
                          <input placeholder="Chest, Leg Day..." className="bg-gray-50 flex-1 px-4 py-3 rounded-2xl outline-none border border-transparent focus:border-cyan-200" onChange={(e) => setFilterValue(e.target.value)} />
                          <Button onClick={(e) => { const input = (e.currentTarget.previousSibling as HTMLInputElement).value; if(input) applyFilter('name', input); }} className="px-4 py-0 rounded-2xl">Go</Button>
                       </div>
                    </div>
                    <Button variant="secondary" className="w-full" onClick={() => applyFilter('all', '')}>Clear Filters</Button>
                 </div>
            </Modal>
        </div>
    );
};

// ... CalendarView and ProfileView are simple pass-throughs with updated context. 
// I will include ProfileView and CalendarView below to ensure they work with new Context structure

const CalendarView = () => {
   // Simplified for brevity, same structure as before but context is new
   const { workouts, deleteWorkout, copyWorkout } = useContext(GymContext);
   const navigate = useNavigate();
   const today = formatDate(new Date());
   
   const [currentDate, setCurrentDate] = useState(new Date());
   const [selectedDayWorkouts, setSelectedDayWorkouts] = useState<Workout[]>([]);
   
   // Action & Modals
   const [actionMenuOpen, setActionMenuOpen] = useState(false);
   const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
   const [deleteModalOpen, setDeleteModalOpen] = useState(false);
   const [copyModalOpen, setCopyModalOpen] = useState(false);
   const [targetDate, setTargetDate] = useState(today);

   const year = currentDate.getFullYear();
   const month = currentDate.getMonth();
   
   const daysInMonth = new Date(year, month + 1, 0).getDate();
   const firstDay = new Date(year, month, 1).getDay();

   const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
   const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

   const getWorkoutsForDay = (day: number) => {
       const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
       return workouts.filter(w => w.date === dateStr);
   };

   const handleDayClick = (day: number) => {
       const w = getWorkoutsForDay(day);
       setSelectedDayWorkouts(w);
   };

   useEffect(() => {
       const today = new Date();
       if (today.getMonth() === month && today.getFullYear() === year) {
           handleDayClick(today.getDate());
       } else {
           setSelectedDayWorkouts([]);
       }
   }, [month, year, workouts]);

   const handleOpenActionMenu = (id: string) => { setSelectedActionId(id); setActionMenuOpen(true); };
   const confirmDelete = () => { if (selectedActionId) { deleteWorkout(selectedActionId); setDeleteModalOpen(false); setSelectedActionId(null); } };
   const confirmCopy = () => { if (selectedActionId) { copyWorkout(selectedActionId, targetDate); setCopyModalOpen(false); setSelectedActionId(null); } };

   const ActionMenu: React.FC<{ isOpen: boolean, onClose: () => void, onCopy: () => void, onDelete: () => void }> = ({ isOpen, onClose, onCopy, onDelete }) => {
        if (!isOpen) return null;
        return (
            <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in">
                <div className="bg-white rounded-t-[32px] p-6 pb-12 animate-in slide-in-from-bottom duration-300">
                    <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-6"></div>
                    <h3 className="font-bold text-xl text-gray-900 mb-6 text-center">Workout Options</h3>
                    <div className="space-y-3">
                        <Button onClick={() => { onCopy(); onClose(); }} className="w-full bg-cyan-50 text-cyan-600 shadow-none hover:bg-cyan-100 justify-start"><Copy size={20} /> Schedule Copy</Button>
                        <Button onClick={() => { onDelete(); onClose(); }} variant="danger" className="w-full justify-start bg-red-50 text-red-500 shadow-none hover:bg-red-100"><Trash2 size={20} /> Delete Workout</Button>
                        <div className="h-4"></div>
                        <Button onClick={onClose} variant="secondary" className="w-full">Cancel</Button>
                    </div>
                </div>
            </div>
        );
   };

   return (
      <div className="px-6 pt-8 pb-32 bg-white min-h-screen">
         <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-8">Calendar</h1>
         <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-900">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
            <div className="flex gap-2">
                <button onClick={handlePrevMonth} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-600 hover:bg-gray-100"><ChevronLeft size={20} /></button>
                <button onClick={handleNextMonth} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-600 hover:bg-gray-100"><ChevronRight size={20} /></button>
            </div>
         </div>
         <div className="grid grid-cols-7 gap-2 mb-8 text-center select-none">
            {['S','M','T','W','T','F','S'].map(d => (<div key={d} className="text-xs font-bold text-gray-400 py-2">{d}</div>))}
            {Array.from({ length: firstDay }).map((_, i) => (<div key={`empty-${i}`} className="aspect-square"></div>))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayWorkouts = getWorkoutsForDay(day);
                const isSelected = selectedDayWorkouts.length > 0 && getDayNumber(selectedDayWorkouts[0].date) === day && new Date(selectedDayWorkouts[0].date).getMonth() === month;
                const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
                return (
                    <div key={day} onClick={() => handleDayClick(day)} className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative cursor-pointer transition-all active:scale-95 ${isSelected ? 'bg-cyan-400 text-white shadow-lg shadow-cyan-200' : isToday ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-transparent text-gray-700 hover:bg-gray-50'}`}>
                        <span className="text-sm">{day}</span>
                        {dayWorkouts.length > 0 && (<div className="flex gap-1 mt-1">{dayWorkouts.slice(0, 3).map((_, idx) => (<div key={idx} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-cyan-400'}`}></div>))}</div>)}
                    </div>
                );
            })}
         </div>
         <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">{selectedDayWorkouts.length > 0 ? getDisplayDate(selectedDayWorkouts[0].date) : "Select a day"}</h3>
            <div className="space-y-4">
                {selectedDayWorkouts.length === 0 && (<div className="text-center py-8 text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">No workouts</div>)}
                {selectedDayWorkouts.map(workout => (
                    <div key={workout.id} {...useLongPress(() => handleOpenActionMenu(workout.id), () => navigate(`/workout/${workout.id}`))} className="bg-white p-5 rounded-3xl shadow-lg shadow-gray-100 border border-gray-50 flex justify-between items-center active:scale-[0.99] transition-transform cursor-pointer select-none">
                        <div><h3 className="font-bold text-gray-900">{workout.title}</h3><p className="text-xs text-gray-400">{workout.exercises.length} Exercises {workout.completed && "✓"}</p></div>
                        <MoreHorizontal className="text-gray-300" size={20} />
                    </div>
                ))}
            </div>
         </div>
         <ActionMenu isOpen={actionMenuOpen} onClose={() => setActionMenuOpen(false)} onCopy={() => { setTargetDate(today); setCopyModalOpen(true); }} onDelete={() => setDeleteModalOpen(true)} />
         <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Workout"><div className="text-center"><div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={32} /></div><p className="mb-6 text-gray-600">Are you sure you want to delete this workout?</p><Button variant="danger" className="w-full mb-3" onClick={confirmDelete}>Yes, Delete</Button><Button variant="secondary" className="w-full" onClick={() => setDeleteModalOpen(false)}>Cancel</Button></div></Modal>
         <Modal isOpen={copyModalOpen} onClose={() => setCopyModalOpen(false)} title="Copy Workout"><p className="mb-4 text-gray-600">Select a date to schedule this workout:</p><Input type="date" value={targetDate} min={today} onChange={(e) => setTargetDate(e.target.value)} /><Button className="w-full mb-3" onClick={confirmCopy}>Schedule</Button><Button variant="secondary" className="w-full" onClick={() => setCopyModalOpen(false)}>Cancel</Button></Modal>
      </div>
   )
}

const ProfileView = () => {
    const { user, logout, toggleUnit } = useContext(GymContext);
    return (
        <div className="px-6 pt-8 pb-32 bg-white min-h-screen">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-8">Me</h1>
            <div className="flex flex-col items-center mb-10">
                <div className="p-1 rounded-full border-2 border-cyan-400 mb-4"><img src={user?.photoUrl} alt="Profile" className="w-24 h-24 rounded-full border-4 border-white" /></div>
                <h2 className="text-2xl font-bold text-gray-900">{user?.name}</h2>
                <p className="text-gray-400 text-sm">{user?.email}</p>
            </div>
            <div className="space-y-3"><div className="bg-gray-50 p-4 rounded-2xl flex justify-between items-center"><span className="font-medium text-gray-700">Units</span><button onClick={toggleUnit} className="font-bold text-gray-900 bg-white border border-gray-100 px-4 py-2 rounded-xl shadow-sm hover:bg-gray-50 active:scale-95 transition-all flex items-center gap-2">{user?.preferences.defaultUnit.toUpperCase()}<span className="text-[10px] text-gray-400 bg-gray-100 px-1 rounded">TAP TO CHANGE</span></button></div></div>
            <Button variant="danger" className="w-full mt-10 rounded-2xl" onClick={logout}>Sign Out</Button>
        </div>
    );
}

const WorkoutEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { workouts, addWorkout, updateWorkout, deleteWorkout, exerciseDefs, addExerciseDef, user } = useContext(GymContext);
  
  const [workout, setWorkout] = useState<Workout>({
    id: generateId(),
    date: formatDate(new Date()),
    title: 'New Workout',
    note: '',
    exercises: [],
    completed: false,
    elapsedSeconds: 0,
    startTimestamp: null
  });

  const [showExModal, setShowExModal] = useState(false);
  const [showCreateExModal, setShowCreateExModal] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExDesc, setNewExDesc] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentUnit = user?.preferences.defaultUnit.toUpperCase() || 'LBS';

  useEffect(() => {
    if (id && id !== 'new') {
      const existing = workouts.find(w => w.id === id);
      if (existing) {
          setWorkout(existing);
          const elapsed = existing.elapsedSeconds || 0;
          const additional = existing.startTimestamp ? (Date.now() - existing.startTimestamp) / 1000 : 0;
          setCurrentTime(elapsed + additional);
      }
    }
  }, [id, workouts]);

  useEffect(() => {
      let interval: number;
      if (workout.startTimestamp && !workout.completed) {
          interval = window.setInterval(() => {
             const elapsed = workout.elapsedSeconds || 0;
             const additional = (Date.now() - (workout.startTimestamp || Date.now())) / 1000;
             setCurrentTime(elapsed + additional);
          }, 1000);
      } else {
          setCurrentTime(workout.elapsedSeconds || 0);
      }
      return () => clearInterval(interval);
  }, [workout.startTimestamp, workout.elapsedSeconds, workout.completed]);

  const saveWorkoutToContext = (w: Workout) => {
      const exists = workouts.some(existing => existing.id === w.id);
      if (exists) updateWorkout(w);
      else addWorkout(w);
  };

  const toggleTimer = () => {
      if (workout.completed) return; 
      const now = Date.now();
      let updated: Workout;
      if (workout.startTimestamp) {
          const sessionDuration = (now - workout.startTimestamp) / 1000;
          const newElapsed = (workout.elapsedSeconds || 0) + sessionDuration;
          updated = { ...workout, startTimestamp: null, elapsedSeconds: newElapsed };
      } else {
          updated = { ...workout, startTimestamp: now };
      }
      setWorkout(updated);
      if (updated.exercises.length > 0) saveWorkoutToContext(updated);
  };

  const handleFinish = () => {
      if (workout.exercises.length === 0) {
          if (workouts.some(w => w.id === workout.id)) deleteWorkout(workout.id);
          navigate('/');
          return;
      }
      const now = Date.now();
      let finalElapsed = workout.elapsedSeconds || 0;
      if (workout.startTimestamp) finalElapsed += (now - workout.startTimestamp) / 1000;
      const updated = { ...workout, completed: true, startTimestamp: null, elapsedSeconds: finalElapsed };
      setWorkout(updated);
      saveWorkoutToContext(updated);
      setShowReport(true);
  };

  const handleResume = () => {
      const updated = { ...workout, completed: false };
      setWorkout(updated);
      saveWorkoutToContext(updated);
  };

  const handleExitReport = () => { setShowReport(false); navigate('/'); };
  const handleSaveBack = () => {
      if (workout.exercises.length === 0) {
          if (workouts.some(w => w.id === workout.id)) deleteWorkout(workout.id);
          navigate('/');
      } else {
          saveWorkoutToContext(workout);
          navigate('/');
      }
  };

  const addExercise = (defId: string) => {
    let baseWorkout = workout;
    if (workout.completed) baseWorkout = { ...workout, completed: false };
    const def = exerciseDefs.find(d => d.id === defId);
    const newInstance: ExerciseInstance = { id: generateId(), defId, sets: [{ id: generateId(), weight: 0, reps: 0, completed: false }] };
    const updated = { ...baseWorkout, exercises: [...baseWorkout.exercises, newInstance] };
    setWorkout(updated);
    saveWorkoutToContext(updated); 
    setShowExModal(false);
  };

  const updateSet = (exId: string, setId: string, field: keyof Set, value: any) => {
    const updated = {
      ...workout,
      exercises: workout.exercises.map(ex => ex.id === exId ? { ...ex, sets: ex.sets.map(s => s.id === setId ? { ...s, [field]: value } : s) } : ex)
    };
    setWorkout(updated);
  };

  const addSet = (exId: string) => {
    const updated = {
      ...workout,
      exercises: workout.exercises.map(ex => {
        if (ex.id !== exId) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return { ...ex, sets: [...ex.sets, { id: generateId(), weight: last?.weight || 0, reps: last?.reps || 0, completed: false }] };
      })
    };
    setWorkout(updated);
  };

  const handleCreateExercise = async () => {
      if (!newExName) return;
      setIsProcessing(true);
      const def: ExerciseDef = { id: generateId(), name: newExName, description: newExDesc };
      try {
        if (mediaFile) {
            // 1. Process local blob (IndexedDB) for immediate use
            const { id: localId, type } = await processAndSaveMedia(mediaFile);
            
            // 2. Upload to Supabase Storage
            const blob = await getMediaFromDB(localId); // Fetch back the processed blob
            if (blob) {
                const ext = type === 'video' ? 'mp4' : 'jpg';
                const path = `${user?.id}/${Date.now()}_${def.id}.${ext}`;
                const publicUrl = await uploadMediaToSupabase(blob, path);
                
                // 3. Attach remote URL to Definition
                def.mediaUrl = publicUrl;
                def.mediaType = type;
                // We also keep mediaId for offline fallback if we implemented it, 
                // but for now relying on mediaUrl for remote sync is key.
            }
        }
        await addExerciseDef(def); // Upserts to Supabase
        setShowCreateExModal(false);
        addExercise(def.id);
        setNewExName(''); setNewExDesc(''); setMediaFile(null);
      } catch (e: any) {
        console.error("Failed to create exercise:", e);
        alert(`Error: ${e.message}`);
      } finally {
        setIsProcessing(false);
      }
  };

  const totalVolume = workout.exercises.reduce((acc, ex) => acc + ex.sets.reduce((sAcc, s) => s.completed ? sAcc + (s.weight * s.reps) : sAcc, 0), 0);
  const totalSets = workout.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const completedSets = workout.exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.completed).length, 0);
  const percentage = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white/80 backdrop-blur-md px-4 py-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 shadow-sm">
        <button onClick={handleSaveBack} className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-600 active:scale-95 transition-transform"><ArrowLeft size={20}/></button>
        <div className="flex flex-col items-center" onClick={toggleTimer}>
           <span className={`text-xl font-black font-mono tracking-widest ${workout.startTimestamp ? 'text-green-500' : 'text-gray-400'}`}>{formatDuration(currentTime)}</span>
           <span className="text-[10px] uppercase font-bold text-gray-300">{workout.startTimestamp ? 'Running' : 'Paused'}</span>
        </div>
        <div className="flex gap-2">
            {!workout.completed && (<button onClick={toggleTimer} className={`w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-95 transition-all ${workout.startTimestamp ? 'bg-amber-400 shadow-amber-200' : 'bg-green-400 shadow-green-200'} shadow-lg`}>{workout.startTimestamp ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5"/>}</button>)}
            <button onClick={handleFinish} className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 transition-all ${workout.completed ? 'bg-gray-300' : 'bg-cyan-400 shadow-cyan-200'}`}><Check size={20} strokeWidth={3} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-32">
        <input value={workout.title} onChange={e => setWorkout(prev => ({ ...prev, title: e.target.value }))} className="text-3xl font-black bg-transparent w-full mb-2 outline-none text-gray-900 placeholder-gray-300" placeholder="Workout Title" />
        <input value={workout.note} onChange={e => setWorkout(prev => ({ ...prev, note: e.target.value }))} className="text-base text-gray-500 bg-transparent w-full mb-8 outline-none placeholder-gray-300" placeholder="Add a note..." />
        <div className="space-y-6">
          {workout.exercises.map((ex) => {
            const def = exerciseDefs.find(d => d.id === ex.defId);
            if (!def) return null;
            return (
              <div key={ex.id} className="bg-white rounded-3xl p-5 shadow-sm">
                 <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-4">
                       {(def.mediaId || def.mediaUrl) && (<div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden relative"><MediaResolver mediaId={def.mediaId} mediaUrl={def.mediaUrl} type={def.mediaType} className="w-full h-full object-cover" /></div>)}
                       <div><h4 className="font-bold text-lg text-gray-900">{def.name}</h4><p className="text-xs text-gray-400">{ex.sets.length} Sets</p></div>
                    </div>
                    <button onClick={() => setWorkout(p => ({...p, exercises: p.exercises.filter(e => e.id !== ex.id)}))} className="text-gray-300 hover:text-red-400"><X size={20}/></button>
                 </div>
                 <div className="space-y-2">
                    {ex.sets.map((set, idx) => (
                       <div key={set.id} className="flex items-center gap-3">
                          <div className="w-6 text-center text-xs font-bold text-gray-300">{idx + 1}</div>
                          <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2 flex items-center gap-2">
                             <input type="number" value={set.weight} onChange={e => updateSet(ex.id, set.id, 'weight', Number(e.target.value))} className="w-full bg-transparent outline-none font-bold text-gray-900 text-center" />
                             <span className="text-xs text-gray-400 font-medium">{currentUnit}</span>
                          </div>
                          <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2 flex items-center gap-2">
                             <input type="number" value={set.reps} onChange={e => updateSet(ex.id, set.id, 'reps', Number(e.target.value))} className="w-full bg-transparent outline-none font-bold text-gray-900 text-center" />
                             <span className="text-xs text-gray-400 font-medium">REPS</span>
                          </div>
                          <button onClick={() => updateSet(ex.id, set.id, 'completed', !set.completed)} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${set.completed ? 'bg-cyan-400 text-white shadow-lg shadow-cyan-200' : 'bg-gray-100 text-gray-300'}`}><Check size={18} /></button>
                       </div>
                    ))}
                 </div>
                 <button onClick={() => addSet(ex.id)} className="w-full mt-3 py-2 text-sm font-bold text-cyan-500 bg-cyan-50 rounded-xl hover:bg-cyan-100 transition-colors">+ Add Set</button>
              </div>
            );
          })}
          <Button onClick={() => setShowExModal(true)} variant="secondary" className="w-full py-4 bg-gray-200 text-gray-600">Add Exercise</Button>
          {workout.completed && (<Button onClick={handleResume} variant="primary" className="w-full py-4 bg-amber-400 shadow-amber-200 mt-4">Resume Workout</Button>)}
        </div>
      </div>

      <Modal isOpen={showExModal} onClose={() => setShowExModal(false)} title="Exercises">
         <div className="space-y-2">{exerciseDefs.map(def => (<div key={def.id} onClick={() => addExercise(def.id)} className="p-4 bg-gray-50 hover:bg-gray-100 rounded-2xl flex justify-between items-center cursor-pointer transition-colors"><span className="font-bold text-gray-700">{def.name}</span><Plus size={18} className="text-gray-400" /></div>))}<Button className="w-full mt-4" onClick={() => setShowCreateExModal(true)}>Create New</Button></div>
      </Modal>

      <Modal isOpen={showCreateExModal} onClose={() => setShowCreateExModal(false)} title="New Exercise">
         <Input placeholder="Name" value={newExName} onChange={e => setNewExName(e.target.value)} />
         <Input placeholder="Description" value={newExDesc} onChange={e => setNewExDesc(e.target.value)} />
         <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-gray-400 mb-4 cursor-pointer relative bg-gray-50">
            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*,video/*" onChange={e => setMediaFile(e.target.files?.[0] || null)} />
            <Camera size={24} className="mb-2"/>
            <span className="text-xs">{mediaFile ? mediaFile.name : "Add Photo/Video"}</span>
         </div>
         <Button onClick={handleCreateExercise} disabled={isProcessing} className="w-full">{isProcessing ? 'Processing...' : 'Save'}</Button>
      </Modal>

      <Modal isOpen={showReport} onClose={handleExitReport} title="Session Report">
          <div className="flex flex-col items-center text-center">
             <div className="w-24 h-24 rounded-full bg-cyan-50 flex items-center justify-center text-cyan-500 mb-4 ring-8 ring-cyan-50/50"><Check size={48} strokeWidth={4} /></div>
             <h2 className="text-2xl font-black text-gray-900 mb-1">Great Job!</h2>
             <p className="text-gray-400 text-sm mb-6">Workout Completed</p>
             <div className="grid grid-cols-2 w-full gap-4 mb-8">
                <div className="bg-gray-50 p-4 rounded-2xl"><p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Duration</p><p className="text-xl font-black text-gray-900 mt-1">{formatDuration(currentTime)}</p></div>
                <div className="bg-gray-50 p-4 rounded-2xl"><p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Completion</p><p className="text-xl font-black text-gray-900 mt-1">{percentage}%</p></div>
                <div className="bg-gray-50 p-4 rounded-2xl col-span-2"><p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Total Volume</p><p className="text-xl font-black text-gray-900 mt-1">{totalVolume} {currentUnit}</p></div>
             </div>
             <div className="w-full text-left mb-6 max-h-40 overflow-y-auto"><p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Exercises</p>{workout.exercises.map(ex => { const def = exerciseDefs.find(d => d.id === ex.defId); const vol = ex.sets.reduce((a, s) => s.completed ? a + (s.weight * s.reps) : a, 0); return (<div key={ex.id} className="flex justify-between py-2 border-b border-gray-100 last:border-0"><span className="font-medium text-gray-700">{def?.name}</span><span className="text-sm text-gray-400 font-mono">{vol} {currentUnit}</span></div>) })}</div>
             <Button onClick={handleExitReport} className="w-full">Back to Home</Button>
          </div>
      </Modal>
    </div>
  );
};

const BottomNav = () => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  
  if (location.pathname.startsWith('/workout/')) return null;

  return (
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/90 backdrop-blur-md border-t border-gray-100 flex justify-around items-center py-4 pb-8 z-50">
        <Link to="/" className={`flex flex-col items-center gap-1 transition-colors ${isActive('/') ? 'text-cyan-400' : 'text-gray-300 hover:text-gray-500'}`}>
            <Home size={24} strokeWidth={isActive('/') ? 3 : 2} />
        </Link>
        <Link to="/calendar" className={`flex flex-col items-center gap-1 transition-colors ${isActive('/calendar') ? 'text-cyan-400' : 'text-gray-300 hover:text-gray-500'}`}>
            <CalendarIcon size={24} strokeWidth={isActive('/calendar') ? 3 : 2} />
        </Link>
        <div className="w-8"></div> 
        <Link to="/history" className={`flex flex-col items-center gap-1 transition-colors ${isActive('/history') ? 'text-cyan-400' : 'text-gray-300 hover:text-gray-500'}`}>
            <History size={24} strokeWidth={isActive('/history') ? 3 : 2} />
        </Link>
        <Link to="/profile" className={`flex flex-col items-center gap-1 transition-colors ${isActive('/profile') ? 'text-cyan-400' : 'text-gray-300 hover:text-gray-500'}`}>
            <User size={24} strokeWidth={isActive('/profile') ? 3 : 2} />
        </Link>
      </div>
  );
};

const AppContent = () => {
  const { user } = useContext(GymContext);
  if (!user) return <LoginView />;
  return (
    <div className="max-w-md mx-auto min-h-screen bg-white relative shadow-2xl overflow-hidden">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calendar" element={<CalendarView />} />
        <Route path="/history" element={<HistoryView />} />
        <Route path="/profile" element={<ProfileView />} />
        <Route path="/workout/:id" element={<WorkoutEditor />} />
      </Routes>
      <BottomNav />
    </div>
  );
};

export default function App() {
  return (
    <HashRouter>
      <GymProvider>
        <AppContent />
      </GymProvider>
    </HashRouter>
  );
}