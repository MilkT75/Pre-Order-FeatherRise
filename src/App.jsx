import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Home, ListOrdered, PieChart, Plus, X, ChevronLeft, CheckCircle2, RefreshCw, Trash2, Edit3, Settings, Lock, Store, UploadCloud, Receipt, Image as ImageIcon, Eraser, LogOut } from 'lucide-react';

// --- 1. FIREBASE INITIALIZATION (Standard Project Setup) ---
const firebaseConfig = {
  apiKey: "AIzaSyAZyh-2I-_86i8JAh-BAfy__skTXTAZOeA",
  authDomain: "inventory-new-featherrise.firebaseapp.com",
  projectId: "inventory-new-featherrise",
  storageBucket: "inventory-new-featherrise.firebasestorage.app",
  messagingSenderId: "519862097911",
  appId: "1:519862097911:web:7e4c791dd1694e495200f2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- CONFIG & CONSTANTS ---
const ADMIN_PIN = '842019';
const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykYe5Odsj7zGtVj9lsIqLJ3DLC6MywEXb5smkCUeRP74XQEJmDxjm4KwNu37rZwJabmw/exec";

const scrollbarClass = "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-400";

// Default settings if none exist in DB
const DEFAULT_SETTINGS = {
  announcement: "สั่งจองล่วงหน้า 1-2 วันเพื่อความรวดเร็ว",
  promptpayId: "", 
  menus: [
    { id: '1', name: 'ไก่ทอด', price: 25 },
    { id: '2', name: 'ปีกไก่', price: 20 },
    { id: '3', name: 'หมูทอด', price: 30 }
  ],
  pickupDates: [
    { id: 'd1', date: new Date().toISOString().split('T')[0], label: 'รอบปกติ', isOpen: true }
  ]
};

// ==========================================
// 2. iOS Animated Modal Component (จากระบบบัญชี)
// ==========================================
const AnimatedModal = ({ isOpen, onClose, children, maxWidth = "max-w-sm", originClass = "origin-center", bgClass = "bg-white", pClass="p-6" }) => {
  const [render, setRender] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRender(true);
      setTimeout(() => setVisible(true), 10);
    } else {
      setVisible(false);
      const timer = setTimeout(() => setRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div 
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} 
        onClick={onClose} 
      />
      <div 
        className={`relative ${bgClass} rounded-3xl shadow-2xl w-full ${maxWidth} flex flex-col max-h-[90vh] transition-all duration-300 ease-[cubic-bezier(0.17,0.89,0.32,1.15)] ${originClass} ${visible ? 'scale-100 opacity-100 translate-y-0' : 'scale-[0.8] opacity-0 translate-y-4'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`overflow-y-auto flex-1 ${pClass} rounded-3xl ${scrollbarClass}`}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // --- STATE MANAGEMENT ---
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('guest'); 
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState(null);
  
  const [tab, setTab] = useState('dashboard');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [guestSuccess, setGuestSuccess] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // File Upload State
  const fileInputRef = useRef(null);
  const [slipFile, setSlipFile] = useState(null);
  const [slipPreview, setSlipPreview] = useState('');

  // Form State
  const initialForm = { name: '', phone: '', pickupDate: '', items: [{ menu: '', qty: '' }], deposit: '', note: '', status: 'pending', slipUrl: '', totalPrice: 0 };
  const [formData, setFormData] = useState(initialForm);

  // --- FIREBASE AUTH & DATA FETCHING ---
  useEffect(() => {
    signInAnonymously(auth).catch(err => console.error("Auth Error:", err));
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const ordersRef = collection(db, 'preorder_list');
    const unsubOrders = onSnapshot(ordersRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setOrders(data);
    }, (error) => console.error("Firestore Orders Error:", error));

    const settingsRef = doc(db, 'preorder_settings', 'main_config');
    const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data());
      } else {
        setDoc(settingsRef, DEFAULT_SETTINGS);
        setSettings(DEFAULT_SETTINGS);
      }
    }, (error) => console.error("Firestore Settings Error:", error));

    return () => { unsubOrders(); unsubSettings(); };
  }, [user]);

  // --- KEYBOARD EVENT FOR PIN ---
  useEffect(() => {
    if (!showAdminLogin) return;
    const handleKeyDown = (e) => {
      if (/^[0-9]$/.test(e.key)) {
        handlePinInput(pinInput + e.key);
      } else if (e.key === 'Backspace') {
        handlePinInput(pinInput.slice(0, -1));
      } else if (e.key === 'Escape') {
        setShowAdminLogin(false);
        setPinInput('');
        setPinError('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAdminLogin, pinInput]);

  // --- COMPUTED DATA ---
  const filteredOrders = useMemo(() => {
    return orders.filter(o => filterStatus === 'all' || o.status === filterStatus);
  }, [orders, filterStatus]);

  const upcomingOrders = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return orders.filter(o => o.status === 'pending' && (!o.pickupDate || o.pickupDate >= today));
  }, [orders]);

  const unpaidOrders = useMemo(() => orders.filter(o => o.status === 'pending' && (!o.deposit || parseFloat(o.deposit) === 0) && !o.slipUrl), [orders]);

  const menuSummary = useMemo(() => {
    const map = {};
    orders.filter(o => o.status !== 'cancel').forEach(o => {
      (o.items || []).forEach(item => {
        if (item.menu && item.qty) {
          map[item.menu] = (map[item.menu] || 0) + parseInt(item.qty || 0);
        }
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const totalDeposit = useMemo(() => {
    return orders.filter(o => o.status !== 'cancel').reduce((sum, o) => sum + parseFloat(o.deposit || 0), 0);
  }, [orders]);

  const calculatedTotal = useMemo(() => {
    if (!settings?.menus) return 0;
    return formData.items.reduce((sum, item) => {
      const menuObj = settings.menus.find(m => m.name === item.menu);
      const price = menuObj ? Number(menuObj.price) : 0;
      const qty = Number(item.qty) || 0;
      return sum + (price * qty);
    }, 0);
  }, [formData.items, settings?.menus]);

  // --- ACTIONS ---
  const handlePinInput = (val) => {
    setPinError('');
    if (val.length <= 6) {
      setPinInput(val);
      if (val.length === 6) {
        if (val === ADMIN_PIN) {
          setTimeout(() => {
            setRole('admin');
            setShowAdminLogin(false);
            setPinInput('');
          }, 150);
        } else {
          setPinError('รหัส PIN ไม่ถูกต้อง');
          setTimeout(() => setPinInput(''), 500);
        }
      }
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) { 
      alert('ขนาดไฟล์ใหญ่เกินไป (สูงสุด 5MB)');
      return;
    }

    setSlipFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setSlipPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOrder = async () => {
    if (!formData.name.trim()) return alert('กรุณากรอกชื่อลูกค้า');
    if (role === 'admin' && !formData.pickupDate) return alert('กรุณาเลือกวันรับของ');
    
    let finalPickupDate = formData.pickupDate;
    if (role === 'guest' && !finalPickupDate && settings?.pickupDates?.length > 0) {
      const activeDates = settings.pickupDates.filter(d => d.isOpen);
      if (activeDates.length > 0) finalPickupDate = activeDates[0].date;
    }

    const validItems = formData.items.filter(i => i.menu && i.qty);
    if (validItems.length === 0) return alert('กรุณาเลือกเมนูอย่างน้อย 1 รายการ');

    setIsSubmitting(true);
    let finalSlipUrl = formData.slipUrl;

    try {
      if (slipFile) {
        const fileExt = slipFile.name.split('.').pop();
        const fileName = `receipts/slip_${Date.now()}.${fileExt}`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, slipFile);
        finalSlipUrl = await getDownloadURL(storageRef);
      }

      const ordersRef = collection(db, 'preorder_list');
      
      let finalDeposit = formData.deposit;
      if (role === 'guest' && slipFile && calculatedTotal > 0) {
        finalDeposit = calculatedTotal; 
      }

      const payload = {
        ...formData,
        pickupDate: finalPickupDate,
        items: validItems,
        totalPrice: calculatedTotal,
        deposit: finalDeposit,
        slipUrl: finalSlipUrl,
        updatedAt: new Date().toISOString()
      };

      if (editId) {
        await updateDoc(doc(ordersRef, editId), payload);
      } else {
        await addDoc(ordersRef, { ...payload, createdAt: new Date().toISOString() });
      }

      if (role === 'guest') {
        setGuestSuccess(true);
      } else {
        setIsModalOpen(false);
      }
      
      setFormData(initialForm);
      setSlipFile(null);
      setSlipPreview('');
      setEditId(null);
    } catch (err) {
      console.error("Save Error:", err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('ยืนยันลบออเดอร์นี้?')) return;
    try {
      await deleteDoc(doc(db, 'preorder_list', id));
      setIsModalOpen(false);
    } catch (err) {
      console.error("Delete Error:", err);
    }
  };

  const handleUpdateSettings = async (newSettings) => {
    try {
      const settingsRef = doc(db, 'preorder_settings', 'main_config');
      await setDoc(settingsRef, newSettings);
    } catch (err) {
      console.error("Settings Update Error:", err);
      alert("ไม่สามารถบันทึกการตั้งค่าได้");
    }
  };

  const handleSyncToSheets = async () => {
    setSyncing(true);
    try {
      await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_preorders',
          targetSheet: 'PreOrders',
          totalOrders: orders.length,
          totalDeposit: totalDeposit,
          timestamp: new Date().toISOString()
        })
      });
      setTimeout(() => setSyncing(false), 1500);
    } catch (err) {
      console.error("Webhook Error:", err);
      setSyncing(false);
    }
  };

  const openModal = (order = null) => {
    if (order) {
      setEditId(order.id);
      setFormData({ ...order, items: order.items?.length ? order.items : [{ menu: '', qty: '' }] });
      setSlipPreview(order.slipUrl || '');
    } else {
      setEditId(null);
      setFormData(initialForm);
      setSlipPreview('');
    }
    setSlipFile(null);
    setIsModalOpen(true);
  };

  // --- RENDERERS ---

  if (!settings && role === 'guest') {
    return <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center text-orange-400 font-medium">กำลังโหลดข้อมูลร้าน...</div>;
  }

  // --- GUEST VIEW ---
  if (role === 'guest') {
    if (guestSuccess) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 animate-in zoom-in duration-300">
            <CheckCircle2 size={48} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">ได้รับออเดอร์แล้ว</h2>
          <p className="text-gray-500 mb-10 max-w-xs leading-relaxed">ทางร้านจะติดต่อกลับเพื่อคอนเฟิร์มการจัดส่งนะครับ ขอบคุณที่อุดหนุน!</p>
          <button onClick={() => { setGuestSuccess(false); setFormData(initialForm); setSlipPreview(''); setSlipFile(null); }} className="bg-orange-500 text-white px-8 py-3.5 rounded-2xl font-bold active:scale-[0.98] transition-all shadow-md">
            สั่งเพิ่มอีกออเดอร์
          </button>
        </div>
      );
    }

    const activeDates = settings?.pickupDates?.filter(d => d.isOpen) || [];
    const qrUrl = settings?.promptpayId && calculatedTotal > 0 
      ? `https://promptpay.io/${settings.promptpayId}/${calculatedTotal}.png` 
      : null;

    return (
      <div className="min-h-screen bg-gray-50 pb-10 font-sans text-gray-900 flex flex-col relative overflow-x-hidden">
        
        {/* Header */}
        <div className="bg-orange-500 text-white pt-10 pb-14 px-6 max-w-lg mx-auto w-full text-center shadow-md rounded-b-[2.5rem]">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-md rounded-full mb-4 shadow-sm border border-white/20">
            <Store size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">สั่งจองล่วงหน้า</h1>
          <p className="text-sm text-orange-100 font-medium">
            {settings?.announcement || "ยินดีต้อนรับ"}
          </p>
        </div>

        {/* Content Box */}
        <div className="px-4 md:px-5 max-w-md mx-auto w-full flex-1 space-y-5 -mt-6">
          
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-1.5">
              <span className="w-1.5 h-4 bg-orange-500 rounded-full"></span> ข้อมูลผู้สั่ง
            </h3>
            <div className="space-y-4">
              <div className="relative">
                  <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">ชื่อ-นามสกุล *</span>
                  <input type="text" className="w-full p-3 h-[52px] border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 text-sm transition-all" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="relative">
                  <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">เบอร์โทรศัพท์ติดต่อ *</span>
                  <input type="tel" className="w-full p-3 h-[52px] border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 text-sm transition-all" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-1.5">
               <span className="w-1.5 h-4 bg-orange-500 rounded-full"></span> เลือกรอบรับของ
            </h3>
            {activeDates.length === 0 ? (
              <div className="bg-red-50 text-red-600 text-sm p-4 rounded-xl border border-red-100 text-center font-medium">
                ขออภัยค่ะ ขณะนี้ยังไม่เปิดรับคิว
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {activeDates.map(dateObj => {
                  const d = new Date(dateObj.date);
                  const shortDate = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
                  const isSelected = formData.pickupDate === dateObj.date || (!formData.pickupDate && activeDates[0].date === dateObj.date);
                  return (
                    <button key={dateObj.id} onClick={() => setFormData({...formData, pickupDate: dateObj.date})}
                      className={`p-3.5 rounded-xl text-left border transition-all active:scale-[0.98] ${isSelected ? 'border-orange-500 bg-orange-50 text-orange-800 shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                      <div className="font-bold text-sm">{dateObj.label}</div>
                      <div className={`text-xs mt-1 font-medium ${isSelected ? 'text-orange-600' : 'text-gray-400'}`}>{shortDate}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                 <span className="w-1.5 h-4 bg-orange-500 rounded-full"></span> รายการอาหาร
              </h3>
              <div className="flex gap-2">
                 {/* ปุ่มล้างข้อมูล */}
                 {formData.items.length > 0 && formData.items[0].menu !== '' && (
                    <button onClick={() => setFormData({ ...formData, items: [{ menu: '', qty: '' }] })} className="text-[11px] font-bold text-red-500 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 active:scale-95">
                      <Eraser size={12}/> ล้าง
                    </button>
                 )}
                 <button onClick={() => setFormData({ ...formData, items: [...formData.items, { menu: '', qty: '' }] })} className="text-[11px] font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 active:scale-95">
                   <Plus size={12}/> เพิ่มเมนู
                 </button>
              </div>
            </div>
            
            <div className="space-y-3">
              {formData.items.map((item, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1 relative">
                    <select className="w-full bg-white h-[52px] border border-gray-300 rounded-xl px-3 text-sm outline-none appearance-none font-medium text-gray-700 transition-all focus:ring-2 focus:ring-orange-500" value={item.menu} onChange={e => {
                      const newItems = [...formData.items]; newItems[i].menu = e.target.value; setFormData({ ...formData, items: newItems });
                    }}>
                      <option value="" disabled>เลือกเมนู...</option>
                      {settings?.menus?.map(m => (
                        <option key={m.id} value={m.name}>{m.name} {m.price > 0 ? `(฿${m.price})` : ''}</option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">▼</div>
                  </div>
                  
                  <input type="number" min="1" className="w-20 bg-white h-[52px] border border-gray-300 rounded-xl px-2 text-center text-sm outline-none font-bold text-gray-700 placeholder:font-normal focus:ring-2 focus:ring-orange-500 transition-all" placeholder="จำนวน" value={item.qty} onChange={e => {
                    const newItems = [...formData.items]; newItems[i].qty = e.target.value; setFormData({ ...formData, items: newItems });
                  }} />
                  
                  {formData.items.length > 1 && (
                    <button onClick={() => setFormData({...formData, items: formData.items.filter((_, idx) => idx !== i)})} className="w-[52px] h-[52px] flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 bg-gray-50 border border-gray-200 rounded-xl active:scale-95 transition-all">
                      <Trash2 size={18}/>
                    </button>
                  )}
                </div>
              ))}
              
              {calculatedTotal > 0 && (
                <div className="flex justify-between items-center px-4 py-3.5 bg-orange-50 rounded-xl mt-4 border border-orange-100">
                  <span className="text-sm font-bold text-orange-800">ยอดชำระทั้งหมด:</span>
                  <span className="text-xl font-bold text-orange-600">฿{calculatedTotal.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {calculatedTotal > 0 && settings?.promptpayId && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-1.5">
                 <span className="w-1.5 h-4 bg-orange-500 rounded-full"></span> ชำระเงิน (สแกนเพื่อจ่าย)
              </h3>
              <div className="text-center">
                <div className="bg-gray-50 p-4 rounded-2xl inline-block border border-gray-100 mb-4 shadow-inner">
                   <img src={qrUrl} alt="PromptPay QR Code" className="w-48 h-48 object-contain rounded-xl mix-blend-multiply" />
                </div>
                <p className="text-sm font-bold text-gray-800">พร้อมเพย์: {settings.promptpayId}</p>
                <p className="text-xs font-medium text-gray-500 mt-1">ยอดโอน <span className="font-bold text-orange-600">฿{calculatedTotal.toLocaleString()}</span></p>
                
                <div className="mt-6 pt-5 border-t border-dashed border-gray-200">
                  <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                  
                  {!slipPreview ? (
                    <button onClick={() => fileInputRef.current.click()} className="w-full flex items-center justify-center gap-2 py-3.5 bg-white text-orange-600 rounded-xl text-sm font-bold active:scale-[0.98] border border-orange-200 hover:bg-orange-50 transition-all shadow-sm">
                      <UploadCloud size={18} /> แนบสลิปโอนเงิน (ไม่เกิน 5MB)
                    </button>
                  ) : (
                    <div className="relative inline-block w-full">
                      <img src={slipPreview} alt="Slip Preview" className="w-full h-40 object-cover rounded-xl border border-gray-200 shadow-sm" />
                      <button onClick={() => { setSlipPreview(''); setSlipFile(null); }} className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full shadow-sm hover:bg-red-600 active:scale-90 transition-transform">
                        <X size={14} />
                      </button>
                      <div className="mt-3 text-xs text-green-600 font-bold flex justify-center items-center gap-1.5 bg-green-50 py-2 rounded-lg border border-green-100">
                        <CheckCircle2 size={16} /> แนบสลิปเรียบร้อยแล้ว
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
            <div className="relative">
                <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">หมายเหตุ / ความต้องการพิเศษ</span>
                <textarea className="w-full p-4 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 text-sm transition-all min-h-[80px] resize-none" placeholder="ระบุเพิ่มเติม..." value={formData.note} onChange={e => setFormData({ ...formData, note: e.target.value })} />
            </div>
          </div>

          <div className="pt-2 pb-8">
            <button onClick={handleSaveOrder} disabled={activeDates.length === 0 || isSubmitting} className="w-full bg-orange-600 hover:bg-orange-700 text-white py-4 rounded-2xl font-bold text-base shadow-md active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
              {isSubmitting ? <span className="animate-pulse flex items-center gap-2"><RefreshCw size={18} className="animate-spin" /> กำลังส่งข้อมูล...</span> : <>ยืนยันส่งคำสั่งจอง <ChevronLeft size={18} className="rotate-180" /></>}
            </button>
          </div>
        </div>

        {/* Secret Admin Login Toggle */}
        <div className="py-6 text-center">
          <button onClick={() => setShowAdminLogin(true)} className="p-3 text-gray-300 hover:text-orange-400 transition-colors">
            <Lock size={16} />
          </button>
        </div>

        {/* Modal สำหรับ Login (เรียกใช้ AnimatedModal เหมือนระบบบัญชี) */}
        <AnimatedModal isOpen={showAdminLogin} onClose={() => { setShowAdminLogin(false); setPinInput(''); setPinError(''); }} originClass="origin-top-right" maxWidth="max-w-sm">
            <div className="flex flex-col items-center justify-center mb-6 pt-2">
              <div className="w-14 h-14 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center mb-4 shadow-sm border border-orange-100">
                 <Lock size={26} />
              </div>
              <h3 className="text-xl font-bold text-gray-800">เข้าสู่ระบบ Admin</h3>
              <p className="text-sm text-gray-500 text-center mt-1">ใส่รหัส PIN เพื่อจัดการร้าน<br/><span className="text-[10px] text-orange-400">(พิมพ์บนคีย์บอร์ดได้เลย)</span></p>
            </div>
            
            <div className="mb-6 flex justify-center gap-3">
               {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-300 ${i < pinInput.length ? 'bg-orange-500 border-orange-500 scale-110 shadow-sm shadow-orange-200' : 'border-gray-200'}`} />
               ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button key={n} type="button" onClick={() => handlePinInput(pinInput + n.toString())} className="h-14 bg-gray-50 hover:bg-orange-50 text-gray-900 hover:text-orange-600 rounded-2xl text-xl font-medium active:scale-[0.95] transition-all border border-gray-100">
                  {n}
                </button>
              ))}
              <div />
              <button type="button" onClick={() => handlePinInput(pinInput + '0')} className="h-14 bg-gray-50 hover:bg-orange-50 text-gray-900 hover:text-orange-600 rounded-2xl text-xl font-medium active:scale-[0.95] transition-all border border-gray-100">0</button>
              <button type="button" onClick={() => handlePinInput(pinInput.slice(0, -1))} className="h-14 bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-2xl text-xl font-medium flex items-center justify-center active:scale-[0.95] transition-all border border-gray-100">
                ⌫
              </button>
            </div>
            {pinError && <p className="text-red-500 text-sm mt-5 font-bold animate-pulse text-center bg-red-50 py-2 rounded-lg">{pinError}</p>}
        </AnimatedModal>

      </div>
    );
  }

  // --- ADMIN VIEW ---
  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20 relative">
      
      {/* Header */}
      <div className="bg-orange-500 text-white p-4 shadow-md sticky top-0 z-20 transition-all duration-300">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Store className="w-5 h-5" /> ระบบจัดการร้าน
          </h1>
          <button onClick={() => setRole('guest')} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white border border-white/30 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 shadow-sm">
            <LogOut size={14} /> ออกระบบ
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto mt-4 px-4">
          <div className="flex bg-white rounded-2xl p-1 shadow-sm border border-gray-200 mb-4">
            {[
              { id: 'dashboard', icon: Home, label: 'แดชบอร์ด' },
              { id: 'orders', icon: ListOrdered, label: 'ออเดอร์' },
              { id: 'settings', icon: Settings, label: 'ตั้งค่าร้าน' }
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex-1 flex flex-col items-center py-2.5 gap-1 rounded-xl transition-all duration-200 active:scale-95 ${tab === t.id ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>
                <t.icon size={18} strokeWidth={tab === t.id ? 2.5 : 2} />
                <span className="text-[10px] font-bold">{t.label}</span>
              </button>
            ))}
          </div>

        {tab === 'dashboard' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-orange-500 flex flex-col justify-between h-28 hover:-translate-y-0.5 transition-transform">
                <div className="text-xs text-gray-500 font-bold">รอรับของ</div>
                <div className="text-3xl font-bold text-orange-600">{upcomingOrders.length}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-gray-800 flex flex-col justify-between h-28 hover:-translate-y-0.5 transition-transform">
                <div className="text-xs text-gray-500 font-bold">ออเดอร์ทั้งหมด</div>
                <div className="text-3xl font-bold text-gray-900">{orders.filter(o => o.status !== 'cancel').length}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border-l-4 border-green-500 flex flex-col justify-between h-28 col-span-2 hover:-translate-y-0.5 transition-transform">
                <div className="text-xs text-gray-500 font-bold flex justify-between">
                  <span>ยอดมัดจำที่ยืนยันแล้ว (บาท)</span>
                  {unpaidOrders.length > 0 && <span className="text-red-500 bg-red-50 px-2 py-0.5 rounded-md border border-red-100">รอโอน {unpaidOrders.length} บิล</span>}
                </div>
                <div className="text-3xl font-bold text-green-600">฿{totalDeposit.toLocaleString()}</div>
              </div>
            </div>
            
            <button onClick={handleSyncToSheets} disabled={syncing} className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-sm text-sm transition-all active:scale-[0.98] border ${syncing ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-900 text-white border-gray-800 hover:bg-black'}`}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'กำลังส่งข้อมูล...' : 'Sync ข้อมูลไป Google Sheets'}
            </button>
          </div>
        )}

        {tab === 'orders' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex gap-2 overflow-x-auto pb-2 px-1 rounded-xl" style={{scrollbarWidth: 'none', msOverflowStyle: 'none'}}>
              {[{ id: 'all', label: 'ทั้งหมด' }, { id: 'pending', label: 'รอรับ' }, { id: 'done', label: 'รับแล้ว' }, { id: 'cancel', label: 'ยกเลิก' }].map(f => (
                <button key={f.id} onClick={() => setFilterStatus(f.id)} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 border ${filterStatus === f.id ? 'bg-orange-500 text-white border-orange-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {f.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredOrders.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-2xl border border-dashed border-gray-200 font-medium">ไม่พบรายการออเดอร์</div>
              ) : (
                filteredOrders.map(o => <OrderCard key={o.id} order={o} onEdit={() => openModal(o)} />)
              )}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5 mb-2"><Receipt size={16} className="text-orange-500"/> บัญชีรับเงิน (PromptPay)</h3>
              <p className="text-[11px] text-gray-500 mb-3">ระบุเบอร์โทรหรือบัตรประชาชน เพื่อสร้าง QR Code ให้ลูกค้าแสกนจ่ายอัตโนมัติ</p>
              <input type="text" className="w-full h-[52px] border border-gray-300 rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 focus:bg-white transition-all" value={settings?.promptpayId || ''} onChange={e => handleUpdateSettings({...settings, promptpayId: e.target.value})} placeholder="08XXXXXXXX หรือ 1XXXXXXXXXXXX" />
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 mb-3">ประกาศหน้าร้าน</h3>
              <input type="text" className="w-full h-[52px] border border-gray-300 rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 focus:bg-white transition-all" value={settings?.announcement || ''} onChange={e => handleUpdateSettings({...settings, announcement: e.target.value})} placeholder="เช่น เปิดรับออเดอร์ถึง 18.00 น." />
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-gray-800">รอบวันจัดส่ง / รับของ</h3>
                <button onClick={() => {
                  const newDates = [...(settings?.pickupDates || []), { id: Date.now().toString(), date: new Date().toISOString().split('T')[0], label: 'รอบใหม่', isOpen: true }];
                  handleUpdateSettings({...settings, pickupDates: newDates});
                }} className="text-[11px] font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 hover:bg-orange-100 active:scale-95 transition-all">+ เพิ่มรอบ</button>
              </div>
              <div className="space-y-3">
                {settings?.pickupDates?.map((d, index) => (
                  <div key={d.id} className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute -top-2 left-2 bg-gray-50 px-1 text-[9px] font-semibold text-gray-500 z-10">วันที่</span>
                        <input type="date" className="w-full h-[46px] border border-gray-300 rounded-lg px-3 text-xs outline-none focus:ring-2 focus:ring-orange-500 bg-white" value={d.date} onChange={e => {
                          const newDates = [...settings.pickupDates]; newDates[index].date = e.target.value; handleUpdateSettings({...settings, pickupDates: newDates});
                        }} />
                      </div>
                      <div className="relative flex-1">
                         <span className="absolute -top-2 left-2 bg-gray-50 px-1 text-[9px] font-semibold text-gray-500 z-10">ชื่อรอบ</span>
                         <input type="text" className="w-full h-[46px] border border-gray-300 rounded-lg px-3 text-xs outline-none focus:ring-2 focus:ring-orange-500 bg-white" value={d.label} placeholder="ชื่อรอบ" onChange={e => {
                           const newDates = [...settings.pickupDates]; newDates[index].label = e.target.value; handleUpdateSettings({...settings, pickupDates: newDates});
                         }} />
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-gray-200 mt-1">
                      <label className="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={d.isOpen} onChange={e => {
                          const newDates = [...settings.pickupDates]; newDates[index].isOpen = e.target.checked; handleUpdateSettings({...settings, pickupDates: newDates});
                        }} className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500" />
                        เปิดรับออเดอร์
                      </label>
                      <button onClick={() => {
                        if(confirm('ลบรอบนี้?')) handleUpdateSettings({...settings, pickupDates: settings.pickupDates.filter(x => x.id !== d.id)});
                      }} className="text-xs text-red-500 font-bold p-1 bg-white border border-red-100 rounded-md hover:bg-red-50 active:scale-90 transition-all">ลบ</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-gray-800">รายการเมนู และราคา</h3>
                <button onClick={() => {
                  const newMenus = [...(settings?.menus || []), { id: Date.now().toString(), name: 'เมนูใหม่', price: 0 }];
                  handleUpdateSettings({...settings, menus: newMenus});
                }} className="text-[11px] font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 hover:bg-orange-100 active:scale-95 transition-all">+ เพิ่มเมนู</button>
              </div>
              <div className="space-y-2">
                {settings?.menus?.map((m, index) => (
                  <div key={m.id} className="flex gap-2 items-center">
                    <input type="text" className="h-[46px] flex-1 border border-gray-300 rounded-xl px-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 focus:bg-white transition-all" value={m.name} placeholder="ชื่อเมนู" onChange={e => {
                      const newMenus = [...settings.menus]; newMenus[index].name = e.target.value; handleUpdateSettings({...settings, menus: newMenus});
                    }} />
                    <input type="number" className="h-[46px] w-20 border border-gray-300 rounded-xl px-2 text-center text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 focus:bg-white font-bold transition-all" value={m.price} placeholder="ราคา" onChange={e => {
                      const newMenus = [...settings.menus]; newMenus[index].price = e.target.value; handleUpdateSettings({...settings, menus: newMenus});
                    }} />
                    <button onClick={() => {
                      if(confirm('ลบเมนูนี้?')) handleUpdateSettings({...settings, menus: settings.menus.filter(x => x.id !== m.id)});
                    }} className="h-[46px] w-[46px] flex items-center justify-center text-gray-400 hover:text-red-500 bg-gray-50 border border-gray-200 rounded-xl active:scale-90 transition-all"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {tab === 'orders' && (
        <button onClick={() => openModal()} className="fixed bottom-6 right-6 w-14 h-14 bg-orange-600 text-white rounded-full shadow-[0_4px_12px_rgba(234,88,12,0.4)] flex items-center justify-center active:scale-90 transition-transform z-10 border border-orange-400">
          <Plus size={28} />
        </button>
      )}

      {/* ADMIN EDIT MODAL (ใช้ AnimatedModal แบบเดียวกับระบบบัญชี) */}
      <AnimatedModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} maxWidth="max-w-md" pClass="p-0" originClass="origin-bottom">
         <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-white rounded-t-3xl shrink-0 sticky top-0 z-10">
           <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              {editId ? <Edit3 className="text-orange-500 w-5 h-5"/> : <Plus className="text-orange-500 w-5 h-5"/>}
              {editId ? 'แก้ไขออเดอร์' : 'เพิ่มออเดอร์ใหม่'}
           </h2>
           <button onClick={() => setIsModalOpen(false)} className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 active:scale-90 transition-all"><X size={16}/></button>
         </div>
         
         <div className="p-5 flex-1 space-y-5 bg-gray-50">
           {slipPreview && (
             <div className="mb-2 bg-white p-3 rounded-2xl border border-gray-200 shadow-sm">
               <label className="block text-xs font-bold text-gray-800 mb-2">สลิปการโอนเงินแนบมา:</label>
               <a href={slipPreview} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-gray-100">
                 <img src={slipPreview} alt="Slip" className="w-full h-32 object-cover hover:scale-105 transition-transform duration-300" />
               </a>
             </div>
           )}

           <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-4">
             <div className="relative">
                <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">ชื่อลูกค้า *</span>
                <input type="text" className="w-full h-[52px] border border-gray-300 rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white" placeholder="ชื่อ" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
             </div>
             <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                   <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">เบอร์โทร</span>
                   <input type="tel" className="w-full h-[52px] border border-gray-300 rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white" placeholder="08XXXXXXXX" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div className="relative">
                   <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">วันที่รับของ</span>
                   <input type="date" className="w-full h-[52px] border border-gray-300 rounded-xl px-3 text-xs md:text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white font-medium text-gray-700" value={formData.pickupDate} onChange={e => setFormData({...formData, pickupDate: e.target.value})} />
                </div>
             </div>
           </div>
           
           <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-3">
             <div className="flex justify-between items-center ml-1">
               <label className="block text-xs font-bold text-gray-800">รายการเมนู</label>
               <div className="flex gap-1.5">
                  {formData.items.length > 0 && formData.items[0].menu !== '' && (
                     <button onClick={() => setFormData({ ...formData, items: [{ menu: '', qty: '' }] })} className="text-[10px] text-red-500 font-bold bg-red-50 px-2 py-1 rounded-md border border-red-100 flex items-center gap-1 active:scale-90">
                       <Eraser size={10}/> ล้าง
                     </button>
                  )}
                  <button onClick={() => setFormData({ ...formData, items: [...formData.items, { menu: '', qty: '' }] })} className="text-[10px] text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded-md border border-orange-100 flex items-center gap-1 active:scale-90">
                    <Plus size={10}/> เพิ่ม
                  </button>
               </div>
             </div>
             {formData.items.map((item, i) => (
               <div key={i} className="flex gap-2">
                 <div className="relative flex-1">
                    <select className="w-full h-[46px] border border-gray-300 rounded-xl px-3 text-sm outline-none appearance-none focus:ring-2 focus:ring-orange-500 bg-white font-medium" value={item.menu} onChange={e => {
                      const newItems = [...formData.items]; newItems[i].menu = e.target.value; setFormData({ ...formData, items: newItems });
                    }}>
                      <option value="">เลือกเมนู...</option>
                      {settings?.menus?.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">▼</div>
                 </div>
                 <input type="number" min="1" className="w-16 h-[46px] border border-gray-300 rounded-xl px-2 text-center text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white font-bold" placeholder="จำนวน" value={item.qty} onChange={e => {
                   const newItems = [...formData.items]; newItems[i].qty = e.target.value; setFormData({ ...formData, items: newItems });
                 }} />
                 <button onClick={() => setFormData({...formData, items: formData.items.filter((_, idx) => idx !== i)})} className="w-[46px] h-[46px] flex items-center justify-center text-gray-400 hover:text-red-500 bg-gray-50 border border-gray-200 rounded-xl active:scale-90 transition-all"><Trash2 size={16}/></button>
               </div>
             ))}
           </div>

           <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                   <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">ยอดมัดจำ (฿)</span>
                   <input type="number" className="w-full h-[52px] border border-gray-300 rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white font-bold text-green-600" value={formData.deposit} onChange={e => setFormData({...formData, deposit: e.target.value})} placeholder="0.00" />
                </div>
                <div className="relative">
                   <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">สถานะออเดอร์</span>
                   <select className="w-full h-[52px] border border-gray-300 rounded-xl px-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 bg-white font-bold appearance-none" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                     <option value="pending">⏳ รอรับของ</option>
                     <option value="done">✅ รับแล้ว</option>
                     <option value="cancel">❌ ยกเลิก</option>
                   </select>
                </div>
              </div>
              <div className="relative">
                  <span className="absolute -top-2.5 left-3 bg-white px-1 text-[10px] font-semibold text-gray-500 z-10">หมายเหตุ</span>
                  <textarea className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 bg-white text-sm min-h-[60px] resize-none" value={formData.note} onChange={e => setFormData({...formData, note: e.target.value})} placeholder="ระบุเพิ่มเติม..." />
              </div>
           </div>
         </div>
         
         <div className="p-4 border-t border-gray-200 bg-white rounded-b-3xl shrink-0 flex gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
           {editId && (
             <button onClick={() => handleDelete(editId)} className="w-16 py-3.5 bg-red-50 text-red-500 border border-red-100 rounded-xl font-bold flex items-center justify-center active:scale-95 transition-all"><Trash2 size={18}/></button>
           )}
           <button onClick={handleSaveOrder} disabled={isSubmitting} className="flex-1 py-3.5 bg-orange-600 text-white rounded-xl font-bold shadow-md active:scale-[0.98] transition-all flex justify-center items-center gap-2">
             {isSubmitting ? <span className="animate-pulse">กำลังบันทึก...</span> : <><CheckCircle2 size={18}/> {editId ? 'บันทึกการแก้ไข' : 'สร้างออเดอร์'}</>}
           </button>
         </div>
      </AnimatedModal>

    </div>
  );
}

// --- SUB-COMPONENTS ---
function OrderCard({ order, onEdit }) {
  const isDone = order.status === 'done';
  const isCancel = order.status === 'cancel';
  
  const statusColors = isDone ? 'bg-green-100 text-green-700 border-green-200' : isCancel ? 'bg-red-50 text-red-600 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200';
  const statusText = isDone ? 'รับแล้ว' : isCancel ? 'ยกเลิก' : 'รอรับ';
  
  const d = new Date(order.pickupDate || Date.now());
  const dateStr = order.pickupDate ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : 'ไม่ระบุวัน';

  return (
    <div className={`bg-white p-4 rounded-2xl border shadow-sm relative transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${isCancel ? 'border-gray-200 opacity-60' : 'border-gray-200 border-l-4 border-l-orange-400'}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-bold text-gray-900 text-base">{order.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5 font-medium">{order.phone || '-'}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border shadow-sm ${statusColors}`}>
            {statusText}
          </span>
          <span className="text-[10px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-md border border-gray-200 shadow-sm">
            {dateStr}
          </span>
        </div>
      </div>

      <div className="space-y-1 bg-gray-50 p-2.5 rounded-xl border border-gray-100 mb-3">
        {(order.items || []).filter(i => i.menu).map((i, idx) => (
          <div key={idx} className="flex justify-between items-center text-sm">
            <span className="text-gray-700 font-medium">{i.menu}</span>
            <span className="font-bold text-gray-900">x{i.qty}</span>
          </div>
        ))}
        {order.totalPrice > 0 && (
          <div className="flex justify-between items-center text-sm pt-2 mt-1.5 border-t border-dashed border-gray-200">
            <span className="text-xs font-bold text-gray-500">ยอดรวม:</span>
            <span className="font-bold text-orange-600">฿{order.totalPrice.toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="flex justify-between items-end">
        <div className="flex flex-wrap items-center gap-2">
          <div className={`text-[11px] px-2 py-1 rounded-md font-bold border ${order.deposit && parseFloat(order.deposit) > 0 ? 'text-green-700 bg-green-50 border-green-200' : 'text-gray-500 bg-white border-gray-200'}`}>
            {order.deposit && parseFloat(order.deposit) > 0 ? `จ่ายแล้ว ฿${parseFloat(order.deposit).toLocaleString()}` : 'ยังไม่มัดจำ/ชำระ'}
          </div>
          {order.slipUrl && (
            <a href={order.slipUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded-md font-bold border border-blue-200 transition-colors shadow-sm">
              <ImageIcon size={12}/> สลิป
            </a>
          )}
        </div>
        <button onClick={onEdit} className="flex items-center justify-center p-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 hover:text-blue-500 rounded-lg transition-all active:scale-90 shadow-sm" title="แก้ไขออเดอร์">
          <Edit3 size={14} />
        </button>
      </div>
      {order.note && (
        <div className="mt-3 bg-yellow-50 p-2 rounded-xl text-[11px] text-yellow-800 font-medium border border-yellow-200">
          <span className="font-bold">หมายเหตุ:</span> {order.note}
        </div>
      )}
    </div>
  );
}