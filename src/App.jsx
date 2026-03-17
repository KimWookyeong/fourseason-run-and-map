import React, { useState, useEffect, useRef } from 'react';
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
  Loader2
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 첫 로그인 후 지도 로딩 미흡 해결 최종 버전]
 * 1. 로딩 해결: 닉네임 입력 완료(isSettingNickname 해제) 시 지도 초기화가 즉시 실행되도록 개선
 * 2. 배경색: 인라인 스타일로 배경색(#f0fdf4) 상시 고정
 * 3. 업로드: 이미지 압축 및 장소 선택 기능 완벽 포함
 */

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

const appId = typeof __app_id !== 'undefined' ? __app_id : 'fourseason-run-and-map';

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

  // 이미지 압축 로직
  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 640;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const compressed = await compressImage(event.target.result);
      setFormData(prev => ({ ...prev, image: compressed }));
    };
    reader.readAsDataURL(file);
  };

  // 1. Firebase 인증
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error("Auth error:", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 데이터 실시간 수신
  useEffect(() => {
    if (!user) return;
    const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(reportsCollection, (snapshot) => {
      const formatted = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(formatted);
      updateMarkers(formatted);
    });
    return () => unsubscribe();
  }, [user, nickname]);

  // 3. 지도 라이브러리 로드
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
    return () => { if (leafletMap.current) leafletMap.current.remove(); };
  }, []);

  // 4. 지도 초기화 로직 (의존성 배열에 isSettingNickname 추가하여 로그인 직후 실행 보장)
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
        }, 500); // 렌더링 완료를 위한 충분한 시간 확보
      } else {
        // 이미 생성된 경우 지도 크기 재계산
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
      const iconHtml = `<div style="background-color:${cat.color}; width:30px; height:30px; border-radius:10px; border:2px solid ${isMine ? '#000' : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:16px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.15);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
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

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return alert("사용자 인증 대기 중입니다.");
    
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
      alert("지도로 기록이 업로드되었습니다! 🏁");
    } catch (err) {
      console.error("Upload error:", err);
      alert("업로드 실패! 다시 시도해주세요.");
    } finally {
      setIsUploading(false);
    }
  };

  const getGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setFormData(prev => ({ ...prev, customLocation: coords }));
        setIsLocating(false);
        if (leafletMap.current) leafletMap.current.setView([coords.lat, coords.lng], 16);
      },
      () => { 
        setIsLocating(false); 
        alert("GPS 정보를 가져올 수 없습니다. 지도 중심점으로 기록됩니다."); 
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const clearAllData = async () => {
    if (nickname !== 'admin') return;
    if (window.confirm("주의! 모든 기록을 영구적으로 삭제하시겠습니까?")) {
      const reportsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      const snapshot = await getDocs(reportsCollection);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      alert("초기화 완료!");
    }
  };

  // --- 닉네임 입력 (로그인 화면) ---
  if (isSettingNickname) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 9999 }}>
        <div style={{ backgroundColor: '#10b981', width: '80px', height: '80px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', transform: 'rotate(12deg)', boxShadow: '0 10px 25px rgba(16,185,129,0.2)' }}>
          <Navigation size={40} color="white" fill="white" />
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '900', color: '#1e293b', margin: '0 0 4px 0', letterSpacing: '-0.05em' }}>FOUR SEASONS</h1>
        <p style={{ fontSize: '0.75rem', fontWeight: '900', color: '#10b981', letterSpacing: '0.3em', marginBottom: '40px' }}>RUN & MAP GEUMJEONG</p>
        
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '40px', boxShadow: '0 20px 50px rgba(0,0,0,0.05)', width: '100%', maxWidth: '340px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '900', color: '#1e293b', marginBottom: '10px' }}>반가워요 활동가님!</h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '32px', lineHeight: '1.6' }}>우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="닉네임 입력" style={{ width: '100%', padding: '16px', borderRadius: '20px', backgroundColor: '#f0fdf4', border: 'none', outline: 'none', fontWeight: 'bold', textAlign: 'center', color: '#065f46', fontSize: '1.1rem', marginBottom: '24px' }} autoFocus />
            <button style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '16px', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>참여하기 <ChevronRight size={20}/></button>
          </form>
        </div>
      </div>
    );
  }

  const solvedCount = reports.filter(r => r.status === 'solved').length;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#f0fdf4', fontFamily: '-apple-system, sans-serif' }}>
      <header style={{ height: '65px', backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ backgroundColor: '#10b981', padding: '6px', borderRadius: '10px', color: 'white' }}><Navigation size={16} fill="white"/></div>
          <span style={{ fontSize: '14px', fontWeight: '900', color: '#1e293b' }}>FOUR SEASONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ backgroundColor: '#f0fdf4', color: '#047857', fontWeight: '900', fontSize: '10px', padding: '4px 12px', borderRadius: '20px', border: '1px solid #d1fae5' }}>{nickname}</span>
          <button onClick={handleLogout} style={{ border: 'none', background: '#f1f5f9', padding: '8px', borderRadius: '10px', color: '#64748b', cursor: 'pointer' }}><LogOut size={16}/></button>
        </div>
      </header>

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Tab 1: 지도 */}
        <div style={{ position: 'absolute', inset: 0, visibility: activeTab === 'map' ? 'visible' : 'hidden', opacity: activeTab === 'map' ? 1 : 0, transition: 'opacity 0.3s' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          <div style={{ position: 'absolute', bottom: '24px', left: '16px', right: '16px', zIndex: 1001 }}>
            <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '32px', boxShadow: '0 15px 35px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f0fdf4' }}>
               <div style={{ display: 'flex', gap: '20px', paddingLeft: '10px' }}>
                 <div style={{ textAlign: 'center' }}><p style={{ fontSize: '8px', fontWeight: '900', color: '#cbd5e1', textTransform: 'uppercase' }}>Found</p><p style={{ fontSize: '20px', fontWeight: '900', color: '#1e293b', margin: 0 }}>{reports.length}</p></div>
                 <div style={{ borderLeft: '1px solid #f1f5f9', paddingLeft: '20px', textAlign: 'center' }}><p style={{ fontSize: '8px', fontWeight: '900', color: '#cbd5e1', textTransform: 'uppercase' }}>Solved</p><p style={{ fontSize: '20px', fontWeight: '900', color: '#10b981', margin: 0 }}>{solvedCount}</p></div>
               </div>
               <button onClick={() => setActiveTab('add')} style={{ backgroundColor: '#1e293b', color: 'white', border: 'none', fontWeight: '900', borderRadius: '20px', padding: '14px 24px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><PlusCircle size={18}/> 기록하기</button>
            </div>
          </div>
        </div>

        {/* Tab 2: 기록 추가 (오버레이) */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', transform: activeTab === 'add' ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)', zIndex: 2000, overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '100px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', margin: 0, fontStyle: 'italic' }}>NEW RECORD</h2>
              <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'white', padding: '10px', borderRadius: '14px', color: '#cbd5e1', cursor: 'pointer' }}><X/></button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '24px', color: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '900', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={12}/> GPS</span>
                  <button type="button" onClick={getGPS} style={{ border: 'none', padding: '10px', borderRadius: '12px', fontWeight: '900', fontSize: '10px', backgroundColor: formData.customLocation ? '#10b981' : 'white', color: formData.customLocation ? 'white' : '#1e293b' }}>{isLocating ? "수신 중..." : formData.customLocation ? "수신 완료" : "위치 잡기"}</button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} id="photo-upload" />
                  <label htmlFor="photo-upload" style={{ width: '100%', height: '120px', borderRadius: '24px', border: '2px dashed #d1fae5', background: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}>
                    {formData.image ? <img src={formData.image} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <><Camera size={24} color="#10b981"/><span style={{ fontSize: '10px', fontWeight: '900', color: '#10b981', marginTop: '4px' }}>사진 추가</span></>}
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: '900', color: '#64748b' }}>장소 선택</label>
                <select 
                  value={formData.area} 
                  onChange={e => setFormData({ ...formData, area: e.target.value })} 
                  style={{ width: '100%', padding: '16px', borderRadius: '20px', border: 'none', backgroundColor: 'white', fontSize: '14px', fontWeight: 'bold', color: '#1e293b', appearance: 'none' }}
                >
                  {GEUMJEONG_AREAS.map(area => <option key={area} value={area}>{area}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({ ...formData, category: c.id })} style={{ padding: '14px', borderRadius: '20px', border: '2px solid', borderColor: formData.category === c.id ? '#10b981' : 'transparent', backgroundColor: 'white', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <span style={{ fontSize: '1.2rem' }}>{c.icon}</span><span style={{ fontSize: '11px', fontWeight: '900', color: '#1e293b' }}>{c.label}</span>
                  </button>
                ))}
              </div>
              <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="어떤 상황인가요?" style={{ width: '100%', padding: '20px', borderRadius: '24px', border: 'none', background: 'white', minHeight: '100px', fontSize: '14px', outline: 'none' }} />
              <button disabled={isUploading} style={{ backgroundColor: isUploading ? '#cbd5e1' : '#10b981', color: 'white', border: 'none', padding: '20px', borderRadius: '24px', fontWeight: '900', fontSize: '1.1rem', cursor: isUploading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                {isUploading ? <><Loader2 className="animate-spin" /> 업로드 중...</> : "지도에 업로드"}
              </button>
            </form>
          </div>
        </div>

        {/* Tab 3: 아카이브 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', visibility: activeTab === 'list' ? 'visible' : 'hidden', opacity: activeTab === 'list' ? 1 : 0, transition: 'opacity 0.3s', overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '100px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '32px', fontStyle: 'italic' }}>TEAM ARCHIVE</h2>
            {reports.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontWeight: 'bold' }}>기록이 없습니다.</div> : reports.map(r => (
              <div key={r.id} style={{ backgroundColor: 'white', borderRadius: '32px', padding: '20px', marginBottom: '20px', border: '1px solid #f0fdf4', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '1.5rem', background: '#f0fdf4', padding: '8px', borderRadius: '12px' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div><h4 style={{ margin: 0, fontWeight: '900', color: '#1e293b' }}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4><p style={{ margin: 0, fontSize: '9px', color: '#94a3b8' }}>{new Date(r.discoveredTime).toLocaleString()}</p></div>
                  </div>
                  <button onClick={() => updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id), { status: r.status === 'pending' ? 'solved' : 'pending' })} style={{ border: 'none', padding: '6px 14px', borderRadius: '12px', fontSize: '9px', fontWeight: '900', background: r.status === 'solved' ? '#10b981' : '#f1f5f9', color: r.status === 'solved' ? 'white' : '#94a3b8', cursor: 'pointer' }}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} alt="trash" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '24px', marginBottom: '16px' }} />}
                <p style={{ margin: 0, padding: '16px', background: 'rgba(16,185,129,0.05)', borderRadius: '18px', fontSize: '13px', color: '#475569', fontStyle: 'italic', borderLeft: '4px solid #10b981' }}>{r.description || "기록 내용이 없습니다."}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f8fafc' }}>
                  <span style={{ fontSize: '10px', fontWeight: '900', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}><User size={10}/> {r.userName}</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ background: '#ecfdf5', color: '#10b981', padding: '4px 12px', borderRadius: '10px', fontSize: '9px', fontWeight: '900' }}>{r.area}</span>
                    {(r.userName === nickname || nickname === 'admin') && <button onClick={() => { if(window.confirm("삭제하시겠습니까?")) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', r.id)); }} style={{ border: 'none', background: 'none', color: '#fca5a5', cursor: 'pointer' }}><Trash2 size={16}/></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab 4: 통계 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f0fdf4', visibility: activeTab === 'stats' ? 'visible' : 'hidden', opacity: activeTab === 'stats' ? 1 : 0, transition: 'opacity 0.3s', overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '100px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#1e293b', marginBottom: '32px', fontStyle: 'italic' }}>TEAM STATS</h2>
            <div style={{ backgroundColor: '#1e293b', borderRadius: '32px', padding: '32px', color: 'white', textAlign: 'center', marginBottom: '24px' }}>
               <h3 style={{ fontSize: '3rem', fontWeight: '900', margin: '0 0 8px 0' }}>{solvedCount}</h3>
               <p style={{ fontSize: '0.8rem', fontWeight: '900', color: '#10b981', textTransform: 'uppercase' }}>Cleaned Up!</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: 'white', padding: '24px', borderRadius: '24px', textAlign: 'center' }}><p style={{ margin: 0, fontSize: '9px', fontWeight: '900', color: '#cbd5e1' }}>TOTAL FOUND</p><p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: '900', color: '#1e293b' }}>{reports.length}</p></div>
              <div style={{ background: 'white', padding: '24px', borderRadius: '24px', textAlign: 'center' }}><p style={{ margin: 0, fontSize: '9px', fontWeight: '900', color: '#cbd5e1' }}>SUCCESS RATE</p><p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: '900', color: '#10b981' }}>{reports.length > 0 ? Math.round((solvedCount / reports.length) * 100) : 0}%</p></div>
            </div>
            {nickname === 'admin' && (
              <div style={{ marginTop: '40px', padding: '32px', background: 'white', borderRadius: '32px', border: '2px dashed #fee2e2', textAlign: 'center' }}>
                <h4 style={{ color: '#ef4444', fontWeight: '900', margin: '0 0 10px 0' }}><AlertTriangle size={18}/> 관리자 도구</h4>
                <button onClick={clearAllData} style={{ width: '100%', background: '#ef4444', color: 'white', border: 'none', padding: '16px', borderRadius: '16px', fontWeight: '900', cursor: 'pointer' }}>데이터 전체 삭제</button>
              </div>
            )}
          </div>
        </div>
      </main>

      <nav style={{ height: '80px', backgroundColor: 'white', borderTop: '1px solid #d1fae5', display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: '15px' }}>
        <button onClick={() => setActiveTab('map')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <MapPin size={24} color={activeTab === 'map' ? '#10b981' : '#cbd5e1'} fill={activeTab === 'map' ? '#10b981' : 'none'} strokeWidth={3}/>
          <span style={{ fontSize: '9px', fontWeight: '900', color: activeTab === 'map' ? '#10b981' : '#cbd5e1' }}>MAP</span>
        </button>
        <button onClick={() => setActiveTab('list')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <List size={24} color={activeTab === 'list' ? '#10b981' : '#cbd5e1'} strokeWidth={3}/>
          <span style={{ fontSize: '9px', fontWeight: '900', color: activeTab === 'list' ? '#10b981' : '#cbd5e1' }}>FEED</span>
        </button>
        <button onClick={() => setActiveTab('stats')} style={{ border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <BarChart3 size={24} color={activeTab === 'stats' ? '#10b981' : '#cbd5e1'} strokeWidth={3}/>
          <span style={{ fontSize: '9px', fontWeight: '900', color: activeTab === 'stats' ? '#10b981' : '#cbd5e1' }}>STATS</span>
        </button>
      </nav>

      <style>{`
        body, html { margin: 0; padding: 0; background-color: #f0fdf4 !important; }
        .leaflet-container { z-index: 1 !important; background: #f0fdf4 !important; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; background: transparent; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}