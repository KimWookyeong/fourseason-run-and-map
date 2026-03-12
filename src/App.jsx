import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onValue, set } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  MapPin, 
  BarChart3, 
  PlusCircle, 
  List, 
  Navigation, 
  LocateFixed, 
  Loader2, 
  X, 
  User, 
  AlertTriangle, 
  RefreshCw,
  TrendingUp,
  Camera,
  Trash2,
  Heart,
  ChevronRight,
  Leaf
} from 'lucide-react';

/**
 * [사계절 런앤맵 프로젝트 최종 보강본 - 스타일 내장형]
 * 디자인 도구 로딩 실패를 방지하기 위해 CSS 스타일을 직접 내장했습니다.
 */
const firebaseConfig = {
  apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
  authDomain: "fourseason-run-and-map.firebaseapp.com",
  projectId: "fourseason-run-and-map",
  storageBucket: "fourseason-run-and-map.firebasestorage.app",
  messagingSenderId: "671510183044",
  appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
  measurementId: "G-NNKBYB9Y5G",
  databaseURL: "https://fourseason-run-and-map-default-rtdb.firebaseio.com/" 
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

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
  const [currentTime, setCurrentTime] = useState(new Date());
  const [islocating, setIsLocating] = useState(false);
  
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

  // 지도 라이브러리 로드
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);

    return () => { if (leafletMap.current) leafletMap.current.remove(); };
  }, []);

  // 지도 초기화
  useEffect(() => {
    if (isScriptLoaded && activeTab === 'map' && mapContainerRef.current && !leafletMap.current) {
      setTimeout(() => {
        if (!mapContainerRef.current) return;
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        if (reports.length > 0) updateMarkers(reports);
      }, 200);
    }
  }, [isScriptLoaded, activeTab]);

  // Firebase 인증
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 데이터 실시간 수신
  useEffect(() => {
    if (!user) return;
    const reportsRef = ref(db, 'reports');
    const unsubscribe = onValue(reportsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] })).reverse();
        setReports(formatted);
        updateMarkers(formatted);
      }
    });
    return () => unsubscribe();
  }, [user, isScriptLoaded]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const iconHtml = `<div style="background-color:${cat.color}; width:34px; height:34px; border-radius:12px; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 4px 12px rgba(0,0,0,0.15); transform:rotate(45deg);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [34, 34], iconAnchor: [17, 17] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.label}</b><br/>by ${report.userName}`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, image: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const getGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setFormData(prev => ({ ...prev, customLocation: loc }));
        setIsLocating(false);
        if (leafletMap.current) leafletMap.current.setView([loc.lat, loc.lng], 16);
      },
      () => { setIsLocating(false); alert("GPS를 켜주세요."); }
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;
    const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
    const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
    await push(ref(db, 'reports'), { ...formData, location: loc, userName: nickname, discoveredTime: currentTime.toISOString() });
    setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
    setActiveTab('map');
  };

  /**
   * [메인 화면 - 연한 녹색 업그레이드 디자인]
   * 외부 CSS 없이도 작동하도록 스타일을 객체로 직접 정의했습니다.
   */
  if (isSettingNickname) {
    return (
      <div style={styles.mainContainer}>
        {/* 상단 텍스트 로고 */}
        <div style={styles.logoSection}>
          <h1 style={styles.titleText}>FOUR SEASONS</h1>
          <div style={styles.subTitleText}>
            RUN & MAP GEUMJEONG
          </div>
        </div>

        {/* 메인 입력 카드 */}
        <div style={styles.card}>
          <h2 style={styles.cardHeading}>반가워요!</h2>
          <p style={styles.cardSub}>활동을 위해 닉네임을 입력해 주세요.</p>
          
          <form style={styles.form} onSubmit={(e) => { e.preventDefault(); if(nickname.trim()){ localStorage.setItem('team_nickname', nickname); setIsSettingNickname(false); } }}>
            <div style={styles.inputWrapper}>
              <input 
                type="text" 
                value={nickname} 
                onChange={e => setNickname(e.target.value)} 
                placeholder="예: 금정_철수" 
                style={styles.inputField}
                autoFocus 
              />
            </div>
            <button style={styles.submitButton}>
              기록 시작하기 <ChevronRight size={24} strokeWidth={3} />
            </button>
          </form>
        </div>
        
        <p style={styles.footerText}>© 2024 Four Seasons Team Project</p>
      </div>
    );
  }

  return (
    <div style={{...styles.appRoot, backgroundColor: '#f0fdf4'}}>
      <header style={styles.header}>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <div style={styles.headerIcon}><Navigation size={18} fill="currentColor"/></div>
          <h1 style={styles.headerTitle}>Four Seasons</h1>
        </div>
        <div style={styles.headerUser}>{nickname} 활동가</div>
      </header>

      <main style={styles.mainContent}>
        {/* 탭 1: 지도 */}
        <div style={{...styles.tabView, opacity: activeTab === 'map' ? 1 : 0, zIndex: activeTab === 'map' ? 10 : 0}}>
          <div ref={mapContainerRef} style={{width: '100%', height: '100%'}} />
          <div style={styles.floatingPanel}>
            <div style={styles.statsRow}>
               <div style={{display: 'flex', gap: '24px', paddingLeft: '16px'}}>
                 <div style={{textAlign: 'center'}}><p style={styles.statLabel}>Trash</p><p style={styles.statValue}>{reports.length}</p></div>
                 <div style={styles.statDivider}><p style={styles.statLabel}>Solved</p><p style={{...styles.statValue, color: '#10b981'}}>{reports.filter(r => r.status === 'solved').length}</p></div>
               </div>
               <button onClick={() => setActiveTab('add')} style={styles.recordButton}>
                 <PlusCircle size={20}/> 기록하기
               </button>
            </div>
          </div>
        </div>

        {/* 탭 2: 기록 추가 */}
        <div style={{...styles.tabView, backgroundColor: '#f0fdf4', padding: '24px', overflowY: 'auto', transform: activeTab === 'add' ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.5s ease', zIndex: 50}}>
          <div style={{maxWidth: '400px', margin: '0 auto'}}>
            <div style={styles.formHeader}>
              <h2 style={styles.formTitle}>New Report</h2>
              <button onClick={() => setActiveTab('map')} style={styles.closeButton}><X/></button>
            </div>
            <form onSubmit={handleSave} style={{display: 'flex', flexDirection: 'column', gap: '24px'}}>
              <div style={styles.reportRow}>
                <div style={styles.gpsCard}>
                  <span style={styles.gpsLabel}><MapPin size={14}/> Location</span>
                  <button type="button" onClick={getGPS} style={{...styles.gpsBtn, backgroundColor: formData.customLocation ? '#10b981' : 'white', color: formData.customLocation ? 'white' : '#1a202c'}}>
                    {islocating ? "..." : "위치 잡기"}
                  </button>
                </div>
                <div style={styles.photoBox}>
                  <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} style={{display: 'none'}} id="cam" />
                  <label htmlFor="cam" style={{...styles.photoLabel, borderColor: formData.image ? '#10b981' : '#a7f3d0'}}>
                    {formData.image ? <img src={formData.image} style={styles.previewImg} /> : <Camera size={24} color="#10b981"/>}
                  </label>
                </div>
              </div>
              <div style={styles.categoryGrid}>
                {TRASH_CATEGORIES.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} style={{...styles.catBtn, borderColor: formData.category === c.id ? '#10b981' : 'transparent', color: formData.category === c.id ? '#065f46' : '#94a3b8'}}>
                    <span style={{fontSize: '24px'}}>{c.icon}</span><span style={{fontSize: '12px', fontWeight: '900'}}>{c.label}</span>
                  </button>
                ))}
              </div>
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="어떤 상황인가요?" style={styles.textArea} />
              <button style={styles.saveButton}>기록 업로드</button>
            </form>
          </div>
        </div>

        {/* 탭 3: 활동 피드 */}
        <div style={{...styles.tabView, backgroundColor: '#f0fdf4', padding: '24px', overflowY: 'auto', transform: activeTab === 'list' ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.5s ease', zIndex: 20}}>
          <div style={{maxWidth: '400px', margin: '0 auto'}}>
            <h2 style={styles.formTitle}>Team Feed</h2>
            {reports.map(r => (
              <div key={r.id} style={styles.feedCard}>
                <div style={styles.feedHeader}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                    <span style={styles.feedIconBox}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon}</span>
                    <div>
                      <h4 style={{fontSize: '14px', fontWeight: '900'}}>{TRASH_CATEGORIES.find(c => c.id === r.category)?.label}</h4>
                      <p style={{fontSize: '9px', fontWeight: 'bold', color: '#94a3b8'}}>{new Date(r.discoveredTime).toLocaleString()}</p>
                    </div>
                  </div>
                  <button onClick={() => set(ref(db, `reports/${r.id}/status`), r.status === 'pending' ? 'solved' : 'pending')} style={{...styles.solvedBtn, backgroundColor: r.status === 'solved' ? '#10b981' : '#f1f5f9', color: r.status === 'solved' ? 'white' : '#94a3b8'}}>
                    {r.status === 'solved' ? '해결됨' : '해결하기'}
                  </button>
                </div>
                {r.image && <img src={r.image} style={styles.feedImg} />}
                <p style={styles.feedDesc}>{r.description || "설명 없음"}</p>
                <div style={styles.feedFooter}>
                  <span>👤 {r.userName} 활동가</span>
                  <span style={styles.feedAreaBadge}>{r.area}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <nav style={styles.navbar}>
        <button onClick={() => setActiveTab('map')} style={{...styles.navBtn, color: activeTab === 'map' ? '#10b981' : '#cbd5e1'}}><MapPin size={26}/></button>
        <button onClick={() => setActiveTab('list')} style={{...styles.navBtn, color: activeTab === 'list' ? '#10b981' : '#cbd5e1'}}><List size={26}/></button>
        <button onClick={() => setActiveTab('stats')} style={{...styles.navBtn, color: activeTab === 'stats' ? '#10b981' : '#cbd5e1'}}><BarChart3 size={26}/></button>
      </nav>
    </div>
  );
}

// [내장 스타일 정의 - 어떤 환경에서도 디자인이 깨지지 않음]
const styles = {
  mainContainer: {
    height: '100vh', width: '100vw', backgroundColor: '#f0fdf4',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    paddingTop: '80px', padding: '24px', fontFamily: 'sans-serif'
  },
  logoSection: { textAlign: 'center', marginBottom: '64px' },
  titleText: { fontSize: '52px', fontWeight: '900', color: '#2d3748', letterSpacing: '-0.04em', margin: 0 },
  subTitleText: { color: '#10b981', fontWeight: '900', fontSize: '14px', letterSpacing: '0.5em', marginTop: '16px' },
  card: {
    backgroundColor: 'white', borderRadius: '60px', padding: '48px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.05)', width: '100%', maxWidth: '380px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
  },
  cardHeading: { fontSize: '32px', fontWeight: '900', color: '#2d3748', marginBottom: '16px' },
  cardSub: { color: '#94a3b8', fontSize: '16px', fontWeight: '500', marginBottom: '48px' },
  form: { width: '100%' },
  inputField: {
    width: '100%', padding: '24px', borderRadius: '30px', backgroundColor: '#ecfdf5',
    border: 'none', outline: 'none', fontWeight: 'bold', textAlign: 'center', fontSize: '20px',
    color: '#065f46', marginBottom: '32px', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
  },
  submitButton: {
    width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none',
    fontWeight: '900', padding: '24px', borderRadius: '35px', fontSize: '22px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer'
  },
  footerText: { marginTop: 'auto', marginBottom: '32px', fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', letterSpacing: '0.2em' },
  
  // 앱 내부 스타일
  appRoot: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'sans-serif' },
  header: { backgroundColor: 'rgba(255,255,255,0.8)', padding: '16px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #d1fae5', zIndex: 1000 },
  headerIcon: { backgroundColor: '#059669', padding: '8px', borderRadius: '12px', color: 'white' },
  headerTitle: { fontSize: '14px', fontWeight: '900', color: '#1f2937', textTransform: 'uppercase' },
  headerUser: { fontSize: '11px', fontWeight: 'bold', color: '#059669', backgroundColor: '#d1fae5', padding: '6px 12px', borderRadius: '20px' },
  mainContent: { flex: 1, position: 'relative' },
  tabView: { position: 'absolute', inset: 0, transition: 'opacity 0.3s ease' },
  floatingPanel: { position: 'absolute', bottom: '112px', left: '16px', right: '16px', zIndex: 1001 },
  statsRow: { backgroundColor: 'white', padding: '20px', borderRadius: '36px', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: '9px', fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: '900', color: '#1f2937', margin: 0 },
  statDivider: { borderLeft: '1px solid #f1f5f9', paddingLeft: '24px' },
  recordButton: { backgroundColor: '#1a202c', color: 'white', padding: '16px 24px', borderRadius: '24px', border: 'none', fontWeight: '900', fontSize: '14px', display: 'flex', gap: '8px', alignItems: 'center' },
  formHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' },
  formTitle: { fontSize: '24px', fontWeight: '900', color: '#1f2937', fontStyle: 'italic', textTransform: 'uppercase' },
  closeButton: { padding: '12px', backgroundColor: 'white', borderRadius: '16px', border: 'none', color: '#94a3b8' },
  reportRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  gpsCard: { backgroundColor: '#1a202c', padding: '24px', borderRadius: '32px', color: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '140px' },
  gpsLabel: { fontSize: '10px', fontWeight: '900', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.1em' },
  gpsBtn: { padding: '12px', borderRadius: '16px', border: 'none', fontWeight: '900', fontSize: '10px' },
  photoBox: { position: 'relative' },
  photoLabel: { border: '2px dashed', borderRadius: '32px', height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' },
  previewImg: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '30px' },
  categoryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  catBtn: { padding: '16px', border: '2px solid', borderRadius: '24px', backgroundColor: 'white', display: 'flex', alignItems: 'center', gap: '16px' },
  textArea: { width: '100%', padding: '24px', borderRadius: '32px', height: '144px', border: 'none', backgroundColor: 'white', fontSize: '14px', outline: 'none' },
  saveButton: { width: '100%', padding: '24px', backgroundColor: '#10b981', color: 'white', borderRadius: '32px', border: 'none', fontWeight: '900', fontSize: '18px' },
  feedCard: { backgroundColor: 'white', padding: '24px', borderRadius: '36px', marginBottom: '24px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' },
  feedHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' },
  feedIconBox: { fontSize: '30px', padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '16px' },
  solvedBtn: { padding: '8px 16px', borderRadius: '16px', border: 'none', fontSize: '10px', fontWeight: '900' },
  feedImg: { width: '100%', height: '192px', objectFit: 'cover', borderRadius: '28px', marginBottom: '16px' },
  feedDesc: { fontSize: '14px', fontWeight: '500', color: '#4b5563', padding: '20px', backgroundColor: '#f0fdf4', borderRadius: '28px', borderLeft: '4px solid #10b981' },
  feedFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f0fdf4', fontSize: '11px', fontWeight: 'bold' },
  feedAreaBadge: { backgroundColor: 'white', color: '#10b981', padding: '6px 12px', borderRadius: '20px', border: '1px solid #d1fae5' },
  navbar: { backgroundColor: 'rgba(255,255,255,0.8)', padding: '20px 20px 32px 20px', display: 'flex', justifyContent: 'space-around', borderTop: '1px solid #d1fae5' },
  navBtn: { border: 'none', backgroundColor: 'transparent' }
};