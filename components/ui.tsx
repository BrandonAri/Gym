import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getMediaFromDB } from '../services/utils';
import { ImageOff, Loader2, Trash2, Copy } from 'lucide-react';

// Best-effort haptics (works on many Android devices; iOS Safari/PWAs generally do NOT support vibration).
const haptic = (pattern: number | number[] = 10) => {
  try {
    // @ts-ignore
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      // @ts-ignore
      navigator.vibrate(pattern);
    }
  } catch {
    // no-op
  }
};

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
        haptic(10);
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
    // How far the row can slide to reveal the action button.
    const ACTION_WIDTH = 128; // px
    // Make it easier to fully open on iPhone (one swipe should be enough)
    const OPEN_THRESHOLD = Math.max(18, ACTION_WIDTH * 0.18);
    const VELOCITY_OPEN = 0.55; // px/ms

    const [offsetX, setOffsetX] = useState(0);
    const offsetXRef = useRef(0);
    const [isDragging, setIsDragging] = useState(false);
    const [lockedAxis, setLockedAxis] = useState<'x' | 'y' | null>(null);

    const start = useRef({ x: 0, y: 0 });
    const startTime = useRef(0);
    const baseOffset = useRef(0); // offset at the start of drag (0 or +/- ACTION_WIDTH)
    const rafRef = useRef<number | null>(null);

    const setOffset = (x: number) => {
        // A tiny rubber-band feel near the edges so it doesn't feel "stuck".
        let v = x;
        if (v > ACTION_WIDTH) v = ACTION_WIDTH + (v - ACTION_WIDTH) * 0.12;
        if (v < -ACTION_WIDTH) v = -ACTION_WIDTH + (v + ACTION_WIDTH) * 0.12;
        const clamped = Math.max(-ACTION_WIDTH, Math.min(ACTION_WIDTH, v));
        offsetXRef.current = clamped;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setOffsetX(clamped));
    };

    const close = () => setOffset(0);
    const openLeft = () => setOffset(-ACTION_WIDTH); // reveal Delete
    const openRight = () => setOffset(ACTION_WIDTH); // reveal Copy

    const handlePointerDown = (e: React.PointerEvent) => {
        start.current = { x: e.clientX, y: e.clientY };
        startTime.current = performance.now();
        baseOffset.current = offsetXRef.current;
        setLockedAxis(null);
        setIsDragging(true);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - start.current.x;
        const dy = e.clientY - start.current.y;

        // Direction lock: only capture and drag when it's clearly a horizontal gesture.
        if (!lockedAxis) {
            const adx = Math.abs(dx);
            const ady = Math.abs(dy);
            if (adx < 6 && ady < 6) return;
            if (adx > ady * 1.2) {
                setLockedAxis('x');
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } else {
                setLockedAxis('y');
                return; // let the page scroll
            }
        }

        if (lockedAxis === 'x') {
            // While dragging horizontally, prevent scroll jitter.
            // NOTE: the real fix for iOS is touch-action: pan-y (below), not preventDefault.
            // We keep preventDefault as a best-effort for non-iOS browsers.
            e.preventDefault?.();
            const BOOST = 1.25; // make it feel less "heavy" on touch
            setOffset(baseOffset.current + dx * BOOST);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setIsDragging(false);
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}

        if (lockedAxis !== 'x') {
            // If an action is open, a simple tap closes it.
            if (offsetXRef.current !== 0) close();
            setLockedAxis(null);
            return;
        }

        const x = offsetXRef.current;
        const dt = Math.max(1, performance.now() - startTime.current);
        const dx = x - baseOffset.current;
        const v = Math.abs(dx) / dt;

        // Prefer a one-swipe open if user either:
        // 1) dragged past a small threshold, OR
        // 2) flicked quickly with enough velocity.
        if (x > OPEN_THRESHOLD || (dx > 12 && v > VELOCITY_OPEN)) openRight();
        else if (x < -OPEN_THRESHOLD || (dx < -12 && v > VELOCITY_OPEN)) openLeft();
        else close();

        setLockedAxis(null);
    };

    const onClickCapture = (e: React.MouseEvent) => {
        // If actions are open, tapping the row closes it instead of navigating.
        if (offsetXRef.current !== 0) {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };

    const actionCommon = "h-full flex items-center justify-center font-bold";
    const showCopy = offsetX > 10;
    const showDelete = offsetX < -10;

    return (
        <div
            className="relative w-full overflow-hidden rounded-3xl mb-4 select-none"
            style={{ touchAction: 'pan-y' }}
        >
            {/* Background actions (clickable) */}
            <div className="absolute inset-0 flex justify-between items-stretch">
                <button
                    type="button"
                    className={`${actionCommon} ${showCopy ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150 bg-green-50 text-green-600`}
                    style={{ width: ACTION_WIDTH }}
                    onClick={() => { haptic(10); onSwipeRight(); close(); }}
                    aria-label="Copy workout"
                >
                    <span className="flex items-center gap-2"><Copy size={20} /> Copy</span>
                </button>
                <button
                    type="button"
                    className={`${actionCommon} ${showDelete ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150 bg-red-50 text-red-500`}
                    style={{ width: ACTION_WIDTH }}
                    onClick={() => { haptic(10); onSwipeLeft(); close(); }}
                    aria-label="Delete workout"
                >
                    <span className="flex items-center gap-2">Delete <Trash2 size={20} /></span>
                </button>
            </div>

            {/* Foreground content */}
            <div
                className={`relative bg-white will-change-transform ${isDragging ? '' : 'transition-transform duration-200 ease-out'} ${className || ''}`}
                style={{ transform: `translate3d(${offsetX}px, 0, 0)`, willChange: 'transform', touchAction: 'pan-y' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onClickCapture={onClickCapture}
            >
                {children}
            </div>
        </div>
    );
};

// --- Components ---

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }> = ({ 
  className = '', variant = 'primary', onClick, ...props 
}) => {
  const base = "px-6 py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 pressable";
  const variants = {
    // Warm "yellow" accent (amber) reads better than pure yellow on white and keeps contrast.
    primary: "bg-amber-400 text-gray-900 shadow-lg shadow-amber-100 hover:bg-amber-500",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    danger: "bg-red-50 text-red-500 hover:bg-red-100",
    ghost: "bg-transparent text-gray-500 hover:bg-gray-50"
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
      onClick={(e) => {
        haptic(10);
        onClick?.(e);
      }}
    />
  );
};

export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  panelClassName?: string;
  contentClassName?: string;
  overlayClassName?: string;
}> = ({
  isOpen,
  onClose,
  title,
  children,
  panelClassName,
  contentClassName,
  overlayClassName,
}) => {
  if (!isOpen) return null;

  const overlay = (
    <div
      className={`fixed inset-0 z-[1000] flex items-center justify-center ${
        overlayClassName ??
        'bg-gradient-to-t from-black/40 via-black/25 to-black/10 backdrop-blur-sm'
      } animate__animated animate__fadeIn`}
      style={{ ['--animate-duration' as any]: '260ms' }}
    >
      <div
        className={`bg-white rounded-[32px] shadow-2xl w-full max-w-md mx-4 max-h-[92vh] overflow-hidden flex flex-col animate__animated animate__zoomIn ${
          panelClassName ?? ''
        }`}
        style={{ ['--animate-duration' as any]: '260ms' }}
      >
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-[32px]">
          <h3 className="font-bold text-xl text-gray-900 tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 active:scale-95 transition-all"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className={`flex-1 ${contentClassName ?? 'p-6 overflow-y-auto scroll-area'}`}>
          {children}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') return createPortal(overlay, document.body);
  return overlay;
};


export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="flex flex-col gap-2 mb-4">
    {label && <label className="text-sm font-semibold text-gray-500 ml-1">{label}</label>}
    <input className={`bg-gray-50 border-none rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-amber-200 outline-none transition-all ${className}`} {...props} />
  </div>
);