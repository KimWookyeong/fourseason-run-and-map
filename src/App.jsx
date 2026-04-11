import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { 
  MapPin, 
  BarChart3, 
  PlusCircle, 
  List, 
  Navigation, 
  X, 
  User, 
  AlertTriangle, 
  Camera, 
  ChevronRight, 
  Trash2, 
  LogOut, 
  Loader2,
  ShieldCheck
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 저장 오류 완전 방어 버전]
 * 1. Rule 3 준수: 저장 시도 전 실시간 인증 상태를 다시 확인하고 실패 시 즉시 재인증합니다.
 * 2. Rule 1 준수: 엄격한 Firestore 경로 사용.
 * 3. 에러 핸들링: 단순 '실패' 메시지가 아닌 원인을 추적할 수 있도록 개선했습니다.
 */

// 전역 변수 활용 및 기본 설정
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
      authDomain: "fourseason-run-and-map.firebaseapp.com",
      projectId: "fourseason-run-and-map",
      storageBucket: "fourseason-run-and-map.firebasestorage.app",
      messagingSenderId: "671510183044",
      appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
      databaseURL: "https://fourseason-run-and-map-default-rtdb.firebaseio.com/" 
    };

const appId = typeof __app_id !== 'undefined' ? __app_id : 'fourseason-run-and-map-v2026';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = [35.243, 129.092];

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [isSettingNickname, setIsSettingNickname] = useState(!localStorage.getItem('team_nickname'));
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup',
    area: GEUMJEONG_AREAS[0],
    description: '',
    status: 'pending',
    customLocation: null,
    image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // 1. 초기 인증 로직 강화 (Rule 3)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("초기 인증 에러:", e);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 수신 (인증 보호 추가)
  useEffect(() => {
    if (!user) return;
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(reportsCollection, (snapshot) => {
      const formatted = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.discoveredTime).getTime() - new Date(a.discoveredTime).getTime());
      setReports(formatted);
      updateMarkers(formatted);
    }, (error) => {
      console.error("데이터 수신 중 에러:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // 이미지 압축
  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        }
      };
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (typeof event.target?.result === 'string') {
        const compressed = await compressImage(event.target.result);
        setFormData(prev => ({ ...prev, image: compressed }));
      }
    };
    reader.readAsDataURL(file);
  };

  // 3. 지도 로딩
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; 
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (isScriptLoaded && !isSettingNickname && activeTab === 'map' && mapContainerRef.current) {
      if (!leafletMap.current) {
        setTimeout(() => {
          if (!mapContainerRef.current) return;
          leafletMap.current = window.L.map(mapContainerRef.current, { 
            zoomControl: false, 
            attributionControl: false 
          }).setView(GEUMJEONG_CENTER, 14);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
          updateMarkers(reports);
          setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 400);
        }, 300);
      } else {
        leafletMap.current.invalidateSize();
      }
    }
  }, [isScriptLoaded, activeTab, isSettingNickname]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const isMine = report.userName === nickname;
      const pinColor = isAdmin ? '#ef4444' : (isMine ? '#000' : '#fff');
      const iconHtml = `<div style="background-color:${cat.color}; width:30px; height:30px; border-radius:10px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:16px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  // 4. 저장 기능 대폭 강화 (재인증 로직 포함)
  const handleSave = async (e) => {
    e.preventDefault();
    
    // 강제 인증 체크
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        return alert("네트워크 연결이 불안정합니다. 잠시 후 다시 시도해주세요.");
      }
    }

    let loc = formData.customLocation;
    if (!loc && leafletMap.current) {
      const center = leafletMap.current.getCenter();
      loc = { lat: center.lat, lng: center.lng };
    }

    setIsUploading(true);
    try {
      const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(reportsCollection, { 
        ...formData, 
        location: loc || { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] }, 
        userName: nickname, 
        discoveredTime: new Date().toISOString() 
      });
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("성공적으로 저장되었습니다! 🏁");
    } catch (err) {
      console.error("저장 에러 상세:", err);
      alert("저장하지 못했습니다. (원인: " + (err.code || "알 수 없는 오류") + ")");
    } finally {
      setIsUploading(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm("로그아웃하시겠습니까?")) {
      localStorage.removeItem('team_nickname');
      setNickname('');
      setIsSettingNickname(true);
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
      signOut(auth);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    setIsLoggingIn(true);
    try {
      await signInAnonymously(auth);
      localStorage.setItem('team_nickname', nickname);
      setIsSettingNickname(false);
    } catch (err) {
      alert("참여 중 오류가 발생했습니다.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isSettingNickname) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 9999 }}>
        <div style={{ backgroundColor: '#10b981', width: '80px', height: '80px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', transform: 'rotate(12deg)', boxShadow: '0 10px 25px rgba(16,185,129,0.2)' }}>
          <Navigation size={40} color="white" fill="white" />
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '900', color: '#1e293b', margin: '0 0 4px 0', letterSpacing: '-0.05em' }}>FOUR SEASONS</h1>
        <p style={{ fontSize: '0.75rem', fontWeight: '900', color: '#10b981', letterSpacing: '0.3em', marginBottom: '40px' }}>RUN & MAP GEUMJEONG</p>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '40px', boxShadow: '0 20px 50px rgba(0,0,0,0.05)', width: '100%', maxWidth: '340px', textAlign: 'center' }}>
          <form onSubmit={handleJoin}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="닉네임 입력" style={{ width: '100%', padding: '16px', borderRadius: '20px', backgroundColor: '#f0fdf4', border: 'none', outline: 'none', fontWeight: 'bold', textAlign: 'center', color: '#065f46', fontSize: '1.1rem', marginBottom: '24px' }} autoFocus />
            <button type="submit" style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '16px', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {isLoggingIn ? <Loader2 className="animate-spin" /> : "참여하기"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#f0fdf4', fontFamily: 'sans-serif' }}>
      <header style={{ height: '65px', backgroundColor: 'white', borderBottom: '1px solid #d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ backgroundColor: isAdmin ? '#ef4444' : '#10b981', padding: '6px', borderRadius: '10px', color: 'white' }}>
            {isAdmin ? <ShieldCheck size={16}/> : <Navigation size={16}/>}
          </div>
          <span style={{ fontSize: '14px', fontWeight: '900', color: '#1e293b' }}>FOUR SEASONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ backgroundColor: '#f0fdf4', color: '#047857', fontWeight: '900', fontSize: '10px', padding: '4px 12px', borderRadius: '20px' }}>{nickname}</span>
          <button onClick={handleLogout} style={{ border: 'none', background: '#f1f5f9', padding: '8px', borderRadius: '10px', color: '#64748b' }}><LogOut size={16}/></button>
        </div>
      </header>

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, visibility: activeTab === 'map' ? 'visible' : 'hidden' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          <button onClick={() => setActiveTab('add')} style={{ position: 'absolute', bottom: '24px', left: '16px', right: '16px', backgroundColor: '#1e293b', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '18px', zIndex: 1001, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>기록하기 +</button>
        </div>

        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', display: activeTab === 'add' ? 'block' : 'none', padding: '24px', overflowY: 'auto', zIndex: 2000 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>새 기록</h2>
            <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'white', padding: '10px', borderRadius: '14px' }}><X/></button>
          </div>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <button type="button" onClick={() => { navigator.geolocation.getCurrentPosition(pos => setFormData(prev => ({ ...prev, customLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude } }))); }} style={{ height: '100px', borderRadius: '24px', backgroundColor: '#1e293b', color: 'white', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                   <MapPin size={24} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span style={{ fontSize: '10px', fontWeight: '900' }}>{formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <label style={{ height: '100px', borderRadius: '24px', backgroundColor: 'white', border: '2px dashed #d1fae5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}>
                   <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                   {formData.image ? <img src={formData.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <><Camera size={24} color="#10b981"/><span style={{ fontSize: '10px', fontWeight: '900', color: '#10b981' }}>사진 추가</span></>}
                </label>
             </div>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{ padding: '14px', borderRadius: '20px', border: '2px solid', borderColor: formData.category === c.id ? '#10b981' : 'transparent', background: 'white', fontWeight: '800' }}>
                   <span>{c.icon}</span><span style={{ fontSize: '11px' }}>{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 입력해 주세요." style={{ padding: '18px', borderRadius: '20px', height: '100px', border: 'none', outline: 'none' }} />
             <button disabled={isUploading} style={{ backgroundColor: '#10b981', color: 'white', padding: '18px', borderRadius: '20px', border: 'none', fontWeight: '900', fontSize: '1.1rem' }}>
               {isUploading ? <Loader2 className="animate-spin" /> : "기록 완료"}
             </button>
          </form>
        </div>

        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', display: activeTab === 'list' ? 'block' : 'none', padding: '24px', overflowY: 'auto' }}>
           <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '24px' }}>활동 피드</h2>
           {reports.map(r => (
             <div key={r.id} style={{ background: 'white', padding: '20px', borderRadius: '32px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                   <span style={{ fontWeight: '900', color: '#1e293b' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.userName}</span>
                   {(r.userName === nickname || isAdmin) && <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id))} style={{ border: 'none', background: 'none', color: '#fca5a5' }}><Trash2 size={16}/></button>}
                </div>
                {r.image && <img src={r.image} style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '24px', marginBottom: '12px' }} />}
                <p style={{ margin: 0, fontSize: '14px', color: '#475569' }}>{r.description}</p>
             </div>
           ))}
        </div>
      </main>

      <nav style={{ height: '80px', backgroundColor: 'white', borderTop: '1px solid #d1fae5', display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: '10px' }}>
        <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'none', color: activeTab === 'map' ? '#10b981' : '#cbd5e1' }}><MapPin/><br/><span style={{fontSize:'10px', fontWeight:'900'}}>지도</span></button>
        <button onClick={() => setActiveTab('list')} style={{ border: 'none', background: 'none', color: activeTab === 'list' ? '#10b981' : '#cbd5e1' }}><List/><br/><span style={{fontSize:'10px', fontWeight:'900'}}>피드</span></button>
      </nav>
      <style>{`.leaflet-container { background: #f0fdf4 !important; } .custom-pin { background: none !important; border: none !important; }`}</style>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);