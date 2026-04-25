import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCcw, Zap, ZapOff, AlertCircle, CheckCircle2, Activity, History, Trash2, X, Maximize2, LayoutDashboard, Settings } from 'lucide-react';
import { calculateBlur, rgbToHsv, applyWhiteBalance, autoTrackRegions } from './utils/vision';
import { supabase } from './lib/supabase';

const App = () => {
  const [view, setView] = useState('dashboard');
  const [isCapturing, setIsCapturing] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Load History from Supabase/Local on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('tofu_logs')
        .select('*')
        .order('id', { ascending: false })
        .limit(10);
      
      if (!error && data) {
        setHistory(data);
      } else {
        const local = JSON.parse(localStorage.getItem('tofu_history') || '[]');
        setHistory(local);
      }
    } catch (err) {
      const local = JSON.parse(localStorage.getItem('tofu_history') || '[]');
      setHistory(local);
    }
  };

  const showToast = (message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setView('camera');
    } catch (err) {
      showToast("Izin kamera ditolak. Harap izinkan akses untuk memulai.");
    }
  };

  const toggleFlash = async () => {
    if (!cameraStream) return;
    const track = cameraStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    
    if (capabilities.torch) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: !flashOn }]
        });
        setFlashOn(!flashOn);
      } catch (err) {
        showToast("Flash tidak didukung di perangkat ini.");
      }
    } else {
      showToast("Senter tidak tersedia.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      setFlashOn(false);
    }
    setView('dashboard');
  };

  const captureAndAnalyze = () => {
    if (!videoRef.current || isCapturing) return;
    setIsCapturing(true);

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 1. Blur Detection
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const blurScore = calculateBlur(imageData);
    
    // Threshold blur varies by resolution, but ~10 is basic
    if (blurScore < 5) {
      showToast("Gambar terlalu buram. Mohon stabilkan kamera.");
      setIsCapturing(false);
      return;
    }

    // 2. Auto-tracking based on 4:3 and 3:2 spec
    const regions = autoTrackRegions(ctx, canvas.width, canvas.height);

    const getStats = (box) => {
      // Guard against out of bounds or zero size
      if (box.w <= 0 || box.h <= 0) return { r: 0, g: 0, b: 0 };
      const w = Math.max(1, Math.floor(box.w));
      const h = Math.max(1, Math.floor(box.h));
      const x = Math.max(0, Math.floor(box.x));
      const y = Math.max(0, Math.floor(box.y));
      
      try {
        const data = ctx.getImageData(x, y, w, h).data;
        let r = 0, g = 0, b = 0;
        const count = data.length / 4;
        if (count === 0) return { r: 0, g: 0, b: 0 };
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i+1]; b += data[i+2];
        }
        return { r: Math.round(r/count), g: Math.round(g/count), b: Math.round(b/count) };
      } catch (e) {
        return { r: 0, g: 0, b: 0 };
      }
    };

    const whiteStats = getStats(regions.whiteBox);
    const sensorStats = getStats(regions.sensorBox);

    // Error handling for quality
    if (whiteStats.r < 50 || whiteStats.g < 50 || whiteStats.b < 50) {
      showToast("Area putih tidak terdeteksi. Gunakan pencahayaan yang merata.");
      setIsCapturing(false);
      return;
    }

    // 3. Calibration & Conclusion
    const cleanRGB = applyWhiteBalance(whiteStats, sensorStats);
    const hsv = rgbToHsv(cleanRGB.r, cleanRGB.g, cleanRGB.b);

    // Medical Logic Constraints
    let status = 'CRITICAL';
    let label = 'Infeksi Terdeteksi';
    let pHRange = 'pH 7.5 - 9.0+';

    if (hsv.h >= 50 && hsv.h <= 65) {
      status = 'NOMINAL';
      label = 'Luka Sehat / Normal';
      pHRange = 'pH 4.5 - 6.5';
    } else if (hsv.h >= 30 && hsv.h < 50) {
      status = 'WARNING';
      label = 'Waspada Infeksi';
      pHRange = 'pH 6.6 - 7.4';
    }

    const result = {
      id: Date.now(),
      created_at: new Date().toISOString(),
      rgb: cleanRGB,
      hsv,
      status,
      label,
      ph_range: pHRange,
      blur_score: blurScore.toFixed(2)
    };

    saveAnalysis(result);
  };

  const saveAnalysis = async (result) => {
    setLastAnalysis(result);
    setIsCapturing(false);
    stopCamera();

    // Local Storage
    const newHistory = [result, ...history].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('tofu_history', JSON.stringify(newHistory));

    // Supabase
    try {
      await supabase.from('tofu_logs').insert([
        { 
          rgb_r: result.rgb.r, 
          rgb_g: result.rgb.g, 
          rgb_b: result.rgb.b, 
          h_deg: result.hsv.h,
          status: result.status,
          ph_label: result.ph_range
        }
      ]);
    } catch (err) {
      console.warn("Supabase Sync Failed. Local storage used.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8 font-sans selection:bg-emerald-100">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl border flex items-center gap-3 transition-all animate-in fade-in slide-in-from-top-4 ${
          toast.type === 'error' ? 'bg-red-50 border-red-100 text-red-600' : 'bg-emerald-50 border-emerald-100 text-emerald-600'
        }`}>
          <AlertCircle size={20} />
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      {/* DASHBOARD VIEW - Optimized for Desktop & Mobile */}
      {view === 'dashboard' && (
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
          
          {/* Sidebar / Profile (Desktop Only) */}
          <aside className="hidden lg:flex lg:col-span-3 flex-col space-y-6">
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-brand-green-light rounded-full flex items-center justify-center text-brand-green border-4 border-white shadow-sm mb-4">
                <Activity size={32} />
              </div>
              <h2 className="font-bold text-slate-800 italic uppercase tracking-tighter text-xl">Tofu System</h2>
              <p className="text-slate-400 text-xs mt-1">Health Vision Engineer v2.0</p>
              
              <div className="mt-8 w-full space-y-2">
                <button className="w-full flex items-center gap-3 px-4 py-3 bg-emerald-50 text-emerald-600 rounded-2xl font-bold text-sm">
                  <LayoutDashboard size={18} /> Dashboard
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:bg-slate-50 rounded-2xl font-medium text-sm transition-colors">
                  <History size={18} /> Archives
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:bg-slate-50 rounded-2xl font-medium text-sm transition-colors">
                  <Settings size={18} /> Settings
                </button>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="lg:col-span-9 space-y-6">
            <header className="flex justify-between items-end mb-4">
              <div>
                <h1 className="text-4xl font-black text-slate-900 tracking-tight">Health Dashboard</h1>
                <p className="text-slate-500 text-sm font-medium mt-1">Status Pemindaian Real-time</p>
              </div>
              <div className="flex gap-3">
                <div className="hidden md:flex bg-white px-4 py-2 rounded-2xl border border-slate-100 items-center gap-2 text-slate-400 text-sm font-bold">
                  <Activity size={16} className="text-emerald-500" /> System Online
                </div>
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Action Card */}
              <section className="bg-emerald-500 rounded-[2.5rem] p-8 shadow-xl shadow-emerald-200/50 flex flex-col items-start justify-between text-white relative overflow-hidden group">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:bg-white/20 transition-all duration-500" />
                <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md mb-12">
                  <Camera size={28} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Ambil Photo Klinis</h2>
                  <p className="text-emerald-50/80 text-sm mb-6 max-w-[240px]">Pastikan pencahayaan cukup untuk akurasi sensor kurkumin.</p>
                  <button 
                    onClick={startCamera}
                    className="bg-white text-emerald-600 font-black px-8 py-4 rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                  >
                    Buka Kamera <Maximize2 size={18} />
                  </button>
                </div>
              </section>

              {/* Last Result Card */}
              <section>
                {lastAnalysis ? (
                  <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-100 h-full flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-slate-800 font-bold uppercase tracking-widest text-xs">Analisis Terakhir</h3>
                      <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider ${
                        lastAnalysis.status === 'NOMINAL' ? 'bg-emerald-100 text-emerald-700' : 
                        lastAnalysis.status === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {lastAnalysis.status}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-5 flex-1">
                      <div className={`p-5 rounded-[2rem] shadow-sm ${
                        lastAnalysis.status === 'NOMINAL' ? 'bg-emerald-50 text-emerald-500' : 
                        lastAnalysis.status === 'WARNING' ? 'bg-amber-50 text-amber-500' : 'bg-red-50 text-red-500'
                      }`}>
                        {lastAnalysis.status === 'NOMINAL' ? <CheckCircle2 size={36} /> : 
                         lastAnalysis.status === 'WARNING' ? <AlertCircle size={36} /> : <Activity size={36} />}
                      </div>
                      <div>
                        <p className="text-slate-800 font-black text-2xl leading-none mb-1">{lastAnalysis.label}</p>
                        <p className="text-slate-500 font-bold">{lastAnalysis.ph_range}</p>
                      </div>
                    </div>

                    <div className="mt-8 grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center gap-3">
                        <div 
                          className="w-8 h-8 rounded-lg shadow-sm border-2 border-white shrink-0"
                          style={{ backgroundColor: `rgb(${lastAnalysis.rgb.r}, ${lastAnalysis.rgb.g}, ${lastAnalysis.rgb.b})` }}
                        />
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Warna Sensor</p>
                      </div>
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col justify-center">
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Hue Result</p>
                        <p className="text-xs font-black text-slate-700">{lastAnalysis.hsv.h}° Degree</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-100 h-full flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300">
                      <Activity size={32} />
                    </div>
                    <p className="text-slate-400 font-medium text-sm">Menunggu pemindaian pertama anda</p>
                  </div>
                )}
              </section>
            </div>

            {/* History Grid */}
            <section className="pt-4">
              <div className="flex justify-between items-center mb-6 px-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center text-blue-500">
                    <History size={20} />
                  </div>
                  <h3 className="font-black text-slate-800">Riwayat Terkini</h3>
                </div>
                <button 
                  onClick={() => { if(confirm('Hapus histori?')) { setHistory([]); localStorage.removeItem('tofu_history'); } }}
                  className="bg-white p-2 rounded-xl border border-slate-100 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {history.length === 0 ? (
                  <div className="col-span-full bg-white border-2 border-dashed border-slate-100 rounded-[2rem] p-12 text-center text-slate-400">
                    Belum ada riwayat tercatat di sistem
                  </div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="bg-white p-5 rounded-3xl border border-slate-100 hover:shadow-md transition-shadow group">
                      <div className="flex justify-between items-start mb-4">
                        <div className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase ${
                          item.status === 'NOMINAL' ? 'bg-emerald-50 text-emerald-600' : 
                          item.status === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {item.status}
                        </div>
                        <p className="text-slate-300 text-[9px] font-bold uppercase">{new Date(item.created_at).toLocaleDateString()}</p>
                      </div>
                      <p className="text-slate-800 font-bold mb-1">{item.ph_range}</p>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full border border-slate-100" style={{ backgroundColor: `rgb(${item.rgb.r}, ${item.rgb.g}, ${item.rgb.b})` }} />
                        <p className="text-slate-400 text-[10px] font-medium italic">H: {item.hsv.h}°</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </main>
        </div>
      )}

      {/* CAMERA VIEW */}
      {view === 'camera' && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col animate-in fade-in duration-300">
          <div className="absolute top-8 left-0 right-0 z-20 flex justify-between px-6 items-center">
            <button onClick={stopCamera} className="p-3 bg-white/10 backdrop-blur-md rounded-2xl text-white hover:bg-white/20 transition-colors">
              <X size={24} />
            </button>
            <div className="bg-white/10 backdrop-blur-md px-6 py-2.5 rounded-2xl border border-white/20 shadow-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <p className="text-white text-[10px] font-black tracking-widest uppercase">Precision Scan Active</p>
              </div>
            </div>
            <button 
              onClick={toggleFlash}
              className={`p-3 backdrop-blur-md rounded-2xl transition-all ${flashOn ? 'bg-yellow-400 text-black' : 'bg-white/10 text-white'}`}
            >
              {flashOn ? <ZapOff size={24} /> : <Zap size={24} />}
            </button>
          </div>

          <video 
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
          />

          {/* New 4:3 Overlay Mask for Product Spec */}
          <div className="absolute inset-0 z-10 flex flex-col items-center pointer-events-none">
            <svg className="w-full h-full opacity-70">
              <mask id="cutout">
                <rect width="100%" height="100%" fill="white" />
                <rect x="15%" y="20%" width="70%" height="52.5%" rx="12" fill="black" /> {/* 4:3 Area */}
                <rect x="25%" y="30.6%" width="50%" height="33.3%" rx="8" fill="white" opacity="0.3" /> {/* Inner 3:2 Guide */}
              </mask>
              <rect width="100%" height="100%" fill="#0f172a" mask="url(#cutout)" />
            </svg>

            {/* Visual Frame Guides */}
            <div className="absolute inset-x-[15%] top-[20%] bottom-[27.5%] border-2 border-white/50 rounded-xl border-dashed">
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
                <span className="text-[9px] text-white font-black uppercase tracking-tighter">Cloth Border (4:3)</span>
              </div>
              
              {/* Inner Sensor Frame (3:2) */}
              <div className="absolute inset-x-[15%] top-[20%] bottom-[20%] border-4 border-emerald-400 rounded-2xl flex items-center justify-center">
                <div className="bg-emerald-500/20 px-4 py-1.5 rounded-xl border border-emerald-400/50">
                  <span className="text-[10px] text-emerald-400 font-black uppercase">Sensor Curcumin (3:2)</span>
                </div>
              </div>
            </div>

            <div className="absolute bottom-36 px-10 w-full max-w-sm">
              <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 p-5 rounded-[2rem] text-center shadow-2xl">
                <p className="text-white text-xs font-bold leading-relaxed">
                  Posisikan <span className="text-emerald-400">Kain Putih</span> pada bingkai luar dan <span className="text-emerald-400">Warna Sensor</span> pada bingkai dalam.
                </p>
              </div>
            </div>
          </div>

          {/* Capture Controls */}
          <div className="absolute bottom-10 inset-x-0 z-20 flex justify-center items-center gap-10">
            <button className="p-4 bg-white/10 backdrop-blur-md rounded-full text-white">
              <RefreshCcw size={24} />
            </button>
            
            <button 
              onClick={captureAndAnalyze}
              disabled={isCapturing}
              className={`w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-all active:scale-90 ${isCapturing ? 'opacity-50' : ''}`}
            >
              <div className="w-16 h-16 bg-white rounded-full shadow-lg" />
            </button>

            <div className="w-14" /> {/* Spacer */}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
