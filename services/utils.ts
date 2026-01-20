export const generateId = (): string => Math.random().toString(36).substr(2, 9);

export const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export const getDisplayDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
};

export const getDayNumber = (dateStr: string): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return d;
};

export const getMonthName = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d); 
  return date.toLocaleString('default', { month: 'short' });
};

export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
  }
  return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
};

// --- IndexedDB & Media Handling ---

const DB_NAME = 'IronLogDB';
const STORE_NAME = 'media';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

export const saveMediaToDB = async (blob: Blob): Promise<string> => {
  try {
    const db = await initDB();
    const id = generateId();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      
      tx.onabort = () => reject(new Error('Transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
      tx.oncomplete = () => resolve(id);
      
      const store = tx.objectStore(STORE_NAME);
      if (!(blob instanceof Blob)) {
         reject(new Error("Invalid data type: Not a Blob"));
         return;
      }
      const request = store.put(blob, id);
      request.onerror = () => reject(request.error || new Error('Put request failed'));
    });
  } catch (e: any) {
    throw new Error(e.message || "Database Error");
  }
};

export const getMediaFromDB = async (id: string): Promise<Blob | null> => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
         const res = request.result;
         if (res instanceof Blob) resolve(res);
         else resolve(null);
      };
      request.onerror = () => reject(request.error || new Error("Get request failed"));
    });
  } catch (e) {
    console.error("Error reading media DB", e);
    return null;
  }
};

// Helper: Compress/Resize Image
const compressImage = (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const MAX_SIZE = 1280;
            
            if (width > height) {
                if (width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              canvas.toBlob((b) => {
                  URL.revokeObjectURL(url);
                  if (b && b.size > 0) resolve(b);
                  else reject(new Error('Compression produced invalid blob'));
              }, 'image/jpeg', 0.85);
            } else {
              URL.revokeObjectURL(url);
              reject(new Error('Canvas context failed'));
            }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Failed to load image for compression (Format may be unsupported)"));
        };
        img.src = url;
    });
};

// Helper: Compress Video to "GIF-like" WebM/MP4
const compressVideo = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.src = url;

    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let animationFrameId: number;
    let isRecording = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      video.remove();
      canvas?.remove();
    };

    video.onloadedmetadata = () => {
      const MAX_W = 480; 
      const ratio = video.videoWidth / video.videoHeight;
      let w = video.videoWidth;
      let h = video.videoHeight;

      if (w > MAX_W) {
        w = MAX_W;
        h = w / ratio;
      }

      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      ctx = canvas.getContext('2d');

      if (!ctx) {
        cleanup();
        reject(new Error("Canvas context failed"));
        return;
      }

      // Check support for various mime types, prioritizing mp4/webm
      const types = [
          'video/mp4',
          'video/webm;codecs=vp8', 
          'video/webm'
      ];
      const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
      
      if (!mimeType) {
        cleanup();
        reject(new Error("Video recording not supported on this device"));
        return;
      }

      const stream = (canvas as any).captureStream(15); // 15 FPS
      
      try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1000000 });
      } catch (e) {
        cleanup();
        reject(e);
        return;
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        cleanup();
        resolve(blob);
      };

      recorder.start();
      isRecording = true;
      
      video.play().catch(e => {
        cleanup();
        reject(new Error("Video play failed: " + e.message));
      });

      const draw = () => {
        if (video.paused || video.ended) return;
        if (ctx && canvas) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        animationFrameId = requestAnimationFrame(draw);
      };
      draw();
    };

    video.onended = () => {
       if (recorder && isRecording) {
           recorder.stop();
           isRecording = false;
       }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Video load failed"));
    };

    // Timeout safety
    setTimeout(() => {
      if (recorder && isRecording) {
        video.pause();
        recorder.stop();
        isRecording = false;
      }
    }, 10000);
  });
};

export const processAndSaveMedia = async (file: File): Promise<{ id: string, type: 'image' | 'video' }> => {
  // Loose matching to allow for variances in MIME types (like empty string for some HEIC)
  const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i);
  const isImage = !isVideo && (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|gif|heic|heif|webp)$/i));

  if (!isImage && !isVideo) throw new Error('Unsupported file type');

  let blobToSave: Blob = file;

  if (isImage) {
      try {
        let inputBlob: Blob = file;
        
        // Robust HEIC/HEIF Check
        const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                       file.name.toLowerCase().endsWith('.heif') ||
                       file.type.toLowerCase().includes('heic') || 
                       file.type.toLowerCase().includes('heif');
        
        if (isHeic) {
             console.log("HEIC detected, attempting conversion...");
             if ((window as any).heic2any) {
                try {
                    // Force conversion to JPEG
                    const res = await (window as any).heic2any({ 
                        blob: file, 
                        toType: "image/jpeg", 
                        quality: 0.8 
                    });
                    inputBlob = Array.isArray(res) ? res[0] : res;
                } catch (e) {
                    console.error("heic2any conversion failed:", e);
                    // Continue with original blob, though it may fail compression
                }
             } else {
                 console.warn("heic2any library not found");
             }
        }

        // Always try to compress/normalize. 
        // This validates that the browser can actually render the image data.
        blobToSave = await compressImage(inputBlob);
        
      } catch (e) {
        console.warn("Image compression failed (likely unsupported format), saving original:", e);
        // Fallback: Save original. If it was HEIC and conversion failed, this will likely not display.
        blobToSave = file;
      }
  } else if (isVideo) {
      try {
        blobToSave = await compressVideo(file);
      } catch (e) {
        console.warn("Video compression failed, using original:", e);
        blobToSave = file;
      }
  }
  
  try {
    const id = await saveMediaToDB(blobToSave);
    return { id, type: isImage ? 'image' : 'video' };
  } catch (e: any) {
    throw new Error(`Storage failed: ${e.message || "Unknown error"}`);
  }
};
