import React, { useState, useRef, useEffect } from 'react';
import { getMediaFromDB } from '../services/utils';
import { ImageOff, Loader2, Trash2, Copy } from 'lucide-react';

// --- Media Resolver Component ---
export const MediaResolver: React.FC<{ 
  mediaId?: string; 
  mediaUrl?: string; 
  type?: 'image' | 'video';
  className?: string; 
}> = ({ mediaId, mediaUrl, type, className }) => {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    
    const loadMedia = async () => {
      setIsError(false);
      
      if (mediaId) {
        setIsLoading(true);
        setSrc(undefined);
        try {
          const blob = await getMediaFromDB(mediaId);
          if (!active) return;
          
          if (blob && blob.size > 0) {
            objectUrl = URL.createObjectURL(blob);
            setSrc(objectUrl);
          } else {
            setIsError(true);
          }
        } catch (e) {
          if (active) setIsError(true);
        } finally {
          if (active) setIsLoading(false);
        }
      } else if (mediaUrl) {
        setSrc(mediaUrl);
        setIsLoading(false);
      } else {
        setSrc(undefined);
        setIsLoading(false);
      }
    };

    loadMedia();

    return () => {
      active = false;
      if (objectUrl) {
         URL.revokeObjectURL(objectUrl);
      }
    };
  }, [mediaId, mediaUrl]);

  if (isError) {
    return (
      <div className={`bg-gray-100 flex flex-col items-center justify-center text-gray-300 ${className}`}>
        <ImageOff size={20} />
      </div>
    );
  }

  if (isLoading || (!src && mediaId)) {
     return (
        <div className={`bg-gray-50 flex items-center justify-center text-gray-300 ${className}`}>
           <Loader2 size={16} className="animate-spin" />
        </div>
     );
  }

  if (!src) return null;

  if (type === 'video') {
    return (
      <video 
        src={src} 
        className={className} 
        autoPlay 
        muted 
        loop 
        playsInline
        disablePictureInPicture
        onError={() => setIsError(true)}
      />
    );
  }
  
  return (
    <img 
      src={src} 
      alt="Media" 
      className={className} 
      onError={(e) => {
         console.warn("Media failed to render", e);
         setIsError(true);
      }} 
    />
  );
};

// --- Long Press Hook ---
export function useLongPress(
  callback: () => void,
  onClick: () => void,
  ms = 500
) {
  const [startLongPress, setStartLongPress] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const startPos = useRef<{x: number, y: number} | null>(null);

  useEffect(() => {
    if (startLongPress) {
      timerRef.current = window.setTimeout(() => {
        callback();
        setStartLongPress(false);
      }, ms);
    } else {
      clearTimeout(timerRef.current);
    }

    return () => clearTimeout(timerRef.current);
  }, [startLongPress, callback, ms]);

  const cancel = () => {
      if (startLongPress) {
          setStartLongPress(false);
          clearTimeout(timerRef.current);
      }
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
        startPos.current = { x: e.clientX, y: e.clientY };
        setStartLongPress(true);
    },
    onPointerMove: (e: React.PointerEvent) => {
        if (startLongPress && startPos.current) {
            const moveX = Math.abs(e.clientX - startPos.current.x);
            const moveY = Math.abs(e.clientY - startPos.current.y);
            if (moveX > 10 || moveY > 10) {
                cancel();
            }
        }
    },
    onPointerUp: (e: React.PointerEvent) => {
       if (startLongPress) {
           setStartLongPress(false);
           // Only trigger click if the timer hasn't fired yet
           if (timerRef.current) {
               clearTimeout(timerRef.current);
               onClick();
           }
       }
       startPos.current = null;
    },
    onPointerLeave: () => cancel(),
  };
}

// --- Swipe Logic (Pointer Events) ---

export const useSwipe = ({ onSwipeUp, onSwipeDown, onSwipeLeft, onSwipeRight }: {
    onSwipeUp?: () => void,
    onSwipeDown?: () => void,
    onSwipeLeft?: () => void,
    onSwipeRight?: () => void,
}) => {
    const touchStart = useRef<{x: number, y: number} | null>(null);
    const touchEnd = useRef<{x: number, y: number} | null>(null);

    const minSwipeDistance = 50;

    const onPointerDown = (e: React.PointerEvent) => {
        touchEnd.current = null;
        touchStart.current = {
            x: e.clientX,
            y: e.clientY
        };
        // Important for touch devices to capture movements
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        touchEnd.current = {
            x: e.clientX,
            y: e.clientY
        };
    };

    const onPointerUp = (e: React.PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        if (!touchStart.current || !touchEnd.current) return;
        
        const distanceX = touchStart.current.x - touchEnd.current.x;
        const distanceY = touchStart.current.y - touchEnd.current.y;
        const isHorizontal = Math.abs(distanceX) > Math.abs(distanceY);

        if (isHorizontal) {
            if (Math.abs(distanceX) < minSwipeDistance) return;
            if (distanceX > 0 && onSwipeLeft) onSwipeLeft();
            if (distanceX < 0 && onSwipeRight) onSwipeRight();
        } else {
            if (Math.abs(distanceY) < minSwipeDistance) return;
            if (distanceY > 0 && onSwipeUp) onSwipeUp();
            if (distanceY < 0 && onSwipeDown) onSwipeDown();
        }
    };

    return { onPointerDown, onPointerMove, onPointerUp };
};

// --- Swipeable List Item (Pointer Events) ---
export const SwipeableItem: React.FC<{ 
    children: React.ReactNode, 
    onSwipeLeft: () => void, 
    onSwipeRight: () => void,
    className?: string
}> = ({ children, onSwipeLeft, onSwipeRight, className }) => {
    const [offsetX, setOffsetX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const startX = useRef(0);
    
    // Threshold to trigger action
    const THRESHOLD = 100; 

    const handlePointerDown = (e: React.PointerEvent) => {
        startX.current = e.clientX;
        setIsDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        const currentX = e.clientX;
        const diff = currentX - startX.current;
        // Limit swipe range visually
        if (Math.abs(diff) < 200) {
             setOffsetX(diff);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        
        if (offsetX > THRESHOLD) {
            // Swiped Right -> Copy
            onSwipeRight();
        } else if (offsetX < -THRESHOLD) {
            // Swiped Left -> Delete
            onSwipeLeft();
        }
        setOffsetX(0);
    };

    const getBgColor = () => {
        if (offsetX > 50) return 'bg-green-100 border-green-200';
        if (offsetX < -50) return 'bg-red-100 border-red-200';
        return 'bg-white border-gray-50';
    };

    return (
        <div className="relative w-full overflow-hidden rounded-3xl mb-4 select-none touch-none">
            {/* Background Actions Layer */}
            <div className={`absolute inset-0 flex justify-between items-center px-6 transition-colors duration-200 ${getBgColor()}`}>
                 <div className={`flex items-center gap-2 font-bold ${offsetX > 50 ? 'opacity-100 text-green-600' : 'opacity-0'}`}>
                    <Copy size={24} />
                    Copy
                 </div>
                 <div className={`flex items-center gap-2 font-bold ${offsetX < -50 ? 'opacity-100 text-red-500' : 'opacity-0'}`}>
                    Delete
                    <Trash2 size={24} />
                 </div>
            </div>

            {/* Foreground Content */}
            <div 
                className={`relative bg-white transition-transform duration-75 ease-out ${className}`}
                style={{ transform: `translateX(${offsetX}px)` }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
            >
                {children}
            </div>
        </div>
    );
};

// --- Components ---

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }> = ({ 
  className = '', variant = 'primary', ...props 
}) => {
  const base = "px-6 py-3 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-cyan-400 text-white shadow-lg shadow-cyan-100 hover:bg-cyan-500",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    danger: "bg-red-50 text-red-500 hover:bg-red-100",
    ghost: "bg-transparent text-gray-500 hover:bg-gray-50"
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
};

export const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ 
  isOpen, onClose, title, children 
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white">
          <h3 className="font-bold text-xl text-gray-900 tracking-tight">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">
            ✕
          </button>
        </div>
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="flex flex-col gap-2 mb-4">
    {label && <label className="text-sm font-semibold text-gray-500 ml-1">{label}</label>}
    <input className={`bg-gray-50 border-none rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-cyan-200 outline-none transition-all ${className}`} {...props} />
  </div>
);