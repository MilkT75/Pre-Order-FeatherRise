import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Home,
  ListOrdered,
  PieChart,
  Plus,
  X,
  ChevronLeft,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Edit3,
  Settings,
  Lock,
  Store,
  UploadCloud,
  Receipt,
  Image as ImageIcon,
} from 'lucide-react';

// --- 1. FIREBASE INITIALIZATION (Canvas Environment Rules) ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- CONFIG & CONSTANTS ---
const ADMIN_PIN = '842019';
const GOOGLE_SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbykYe5Odsj7zGtVj9lsIqLJ3DLC6MywEXb5smkCUeRP74XQEJmDxjm4KwNu37rZwJabmw/exec';

// Default settings if none exist in DB
const DEFAULT_SETTINGS = {
  announcement: 'สั่งจองล่วงหน้า 1-2 วันเพื่อความรวดเร็ว',
  promptpayId: '', // เบอร์โทร หรือ บัตรประชาชน พร้อมเพย์
  menus: [
    { id: '1', name: 'ไก่ทอด', price: 25 },
    { id: '2', name: 'ปีกไก่', price: 20 },
    { id: '3', name: 'หมูทอด', price: 30 },
  ],
  pickupDates: [
    {
      id: 'd1',
      date: new Date().toISOString().split('T')[0],
      label: 'รอบปกติ',
      isOpen: true,
    },
  ],
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
  const initialForm = {
    name: '',
    phone: '',
    pickupDate: '',
    items: [{ menu: '', qty: '' }],
    deposit: '',
    note: '',
    status: 'pending',
    slipUrl: '',
    totalPrice: 0,
  };
  const [formData, setFormData] = useState(initialForm);

  // --- FIREBASE AUTH & DATA FETCHING ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (
          typeof __initial_auth_token !== 'undefined' &&
          __initial_auth_token
        ) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Auth Error:', err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Fetch Orders
    const ordersRef = collection(
      db,
      'artifacts',
      appId,
      'public',
      'data',
      'preorder_list'
    );
    const unsubOrders = onSnapshot(
      ordersRef,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setOrders(data);
      },
      (error) => console.error('Firestore Orders Error:', error)
    );

    // Fetch Settings
    const settingsRef = doc(
      db,
      'artifacts',
      appId,
      'public',
      'data',
      'preorder_settings',
      'main_config'
    );
    const unsubSettings = onSnapshot(
      settingsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setSettings(snapshot.data());
        } else {
          setDoc(settingsRef, DEFAULT_SETTINGS);
          setSettings(DEFAULT_SETTINGS);
        }
      },
      (error) => console.error('Firestore Settings Error:', error)
    );

    return () => {
      unsubOrders();
      unsubSettings();
    };
  }, [user]);

  // --- COMPUTED DATA ---
  const filteredOrders = useMemo(() => {
    return orders.filter(
      (o) => filterStatus === 'all' || o.status === filterStatus
    );
  }, [orders, filterStatus]);

  const upcomingOrders = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return orders.filter(
      (o) => o.status === 'pending' && (!o.pickupDate || o.pickupDate >= today)
    );
  }, [orders]);

  const unpaidOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status === 'pending' &&
          (!o.deposit || parseFloat(o.deposit) === 0) &&
          !o.slipUrl
      ),
    [orders]
  );

  const menuSummary = useMemo(() => {
    const map = {};
    orders
      .filter((o) => o.status !== 'cancel')
      .forEach((o) => {
        (o.items || []).forEach((item) => {
          if (item.menu && item.qty) {
            map[item.menu] = (map[item.menu] || 0) + parseInt(item.qty || 0);
          }
        });
      });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const totalDeposit = useMemo(() => {
    return orders
      .filter((o) => o.status !== 'cancel')
      .reduce((sum, o) => sum + parseFloat(o.deposit || 0), 0);
  }, [orders]);

  // Calculate Total Price dynamically
  const calculatedTotal = useMemo(() => {
    if (!settings?.menus) return 0;
    return formData.items.reduce((sum, item) => {
      const menuObj = settings.menus.find((m) => m.name === item.menu);
      const price = menuObj ? Number(menuObj.price) : 0;
      const qty = Number(item.qty) || 0;
      return sum + price * qty;
    }, 0);
  }, [formData.items, settings?.menus]);

  // --- ACTIONS ---
  const handlePinPress = (key) => {
    if (key === 'del') {
      setPinInput((prev) => prev.slice(0, -1));
      setPinError('');
    } else if (pinInput.length < 6) {
      const newPin = pinInput + key;
      setPinInput(newPin);
      if (newPin.length === 6) {
        if (newPin === ADMIN_PIN) {
          setRole('admin');
          setShowAdminLogin(false);
          setPinInput('');
        } else {
          setPinError('PIN ไม่ถูกต้อง');
          setPinInput('');
        }
      }
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      // Limit 5MB
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
    if (role === 'admin' && !formData.pickupDate)
      return alert('กรุณาเลือกวันรับของ');

    let finalPickupDate = formData.pickupDate;
    if (
      role === 'guest' &&
      !finalPickupDate &&
      settings?.pickupDates?.length > 0
    ) {
      const activeDates = settings.pickupDates.filter((d) => d.isOpen);
      if (activeDates.length > 0) finalPickupDate = activeDates[0].date;
    }

    const validItems = formData.items.filter((i) => i.menu && i.qty);
    if (validItems.length === 0)
      return alert('กรุณาเลือกเมนูอย่างน้อย 1 รายการ');

    setIsSubmitting(true);
    let finalSlipUrl = formData.slipUrl;

    try {
      // 1. Upload Slip if exists
      if (slipFile) {
        const fileExt = slipFile.name.split('.').pop();
        const fileName = `receipts/${appId}_${Date.now()}.${fileExt}`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, slipFile);
        finalSlipUrl = await getDownloadURL(storageRef);
      }

      // 2. Save Data
      const ordersRef = collection(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        'preorder_list'
      );

      // Auto set deposit if guest pays via QR
      let finalDeposit = formData.deposit;
      if (role === 'guest' && slipFile && calculatedTotal > 0) {
        finalDeposit = calculatedTotal; // สมมติว่าโอนเต็มจำนวนตามยอดที่คำนวณ
      }

      const payload = {
        ...formData,
        pickupDate: finalPickupDate,
        items: validItems,
        totalPrice: calculatedTotal,
        deposit: finalDeposit,
        slipUrl: finalSlipUrl,
        updatedAt: new Date().toISOString(),
      };

      if (editId) {
        await updateDoc(doc(ordersRef, editId), payload);
      } else {
        await addDoc(ordersRef, {
          ...payload,
          createdAt: new Date().toISOString(),
        });
      }

      if (role === 'guest') {
        setGuestSuccess(true);
      } else {
        setIsModalOpen(false);
      }

      // Reset Forms
      setFormData(initialForm);
      setSlipFile(null);
      setSlipPreview('');
      setEditId(null);
    } catch (err) {
      console.error('Save Error:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('ยืนยันลบออเดอร์นี้?')) return;
    try {
      await deleteDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'preorder_list', id)
      );
      setIsModalOpen(false);
    } catch (err) {
      console.error('Delete Error:', err);
    }
  };

  const handleUpdateSettings = async (newSettings) => {
    try {
      const settingsRef = doc(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        'preorder_settings',
        'main_config'
      );
      await setDoc(settingsRef, newSettings);
    } catch (err) {
      console.error('Settings Update Error:', err);
      alert('ไม่สามารถบันทึกการตั้งค่าได้');
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
          timestamp: new Date().toISOString(),
        }),
      });
      setTimeout(() => setSyncing(false), 1500);
    } catch (err) {
      console.error('Webhook Error:', err);
      setSyncing(false);
    }
  };

  const openModal = (order = null) => {
    if (order) {
      setEditId(order.id);
      setFormData({
        ...order,
        items: order.items?.length ? order.items : [{ menu: '', qty: '' }],
      });
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

  // Admin Login Modal
  const AdminLoginOverlay = () => (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] p-8 w-full max-w-sm text-center shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <div className="w-8" />
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
            <Lock size={20} className="text-gray-900" />
          </div>
          <button
            onClick={() => setShowAdminLogin(false)}
            className="w-8 h-8 flex items-center justify-center text-gray-400 bg-gray-50 rounded-full active:scale-90"
          >
            <X size={16} />
          </button>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          Admin Access
        </h2>

        <div className="flex justify-center gap-3 mb-8">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${
                i < pinInput.length
                  ? 'bg-black border-black'
                  : 'border-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              onClick={() => handlePinPress(n.toString())}
              className="h-14 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-2xl text-xl font-medium text-gray-900 transition-all active:scale-95"
            >
              {n}
            </button>
          ))}
          <div />
          <button
            onClick={() => handlePinPress('0')}
            className="h-14 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-2xl text-xl font-medium text-gray-900 transition-all active:scale-95"
          >
            0
          </button>
          <button
            onClick={() => handlePinPress('del')}
            className="h-14 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-2xl text-xl font-medium text-gray-500 transition-all active:scale-95 flex items-center justify-center"
          >
            ⌫
          </button>
        </div>
        {pinError && (
          <p className="text-red-500 text-sm mt-5 font-medium animate-pulse">
            {pinError}
          </p>
        )}
      </div>
    </div>
  );

  // Guest Loading State
  if (!settings && role === 'guest') {
    return (
      <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center text-gray-400">
        กำลังโหลดข้อมูลร้าน...
      </div>
    );
  }

  // --- GUEST VIEW (Minimalist + Payment) ---
  if (role === 'guest') {
    if (guestSuccess) {
      return (
        <div className="min-h-screen bg-[#FDFDFD] flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 size={48} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            ได้รับออเดอร์แล้ว
          </h2>
          <p className="text-gray-500 mb-10 max-w-xs leading-relaxed">
            ทางร้านจะติดต่อกลับเพื่อคอนเฟิร์มการจัดส่งนะครับ ขอบคุณที่อุดหนุน!
          </p>
          <button
            onClick={() => {
              setGuestSuccess(false);
              setFormData(initialForm);
              setSlipPreview('');
              setSlipFile(null);
            }}
            className="bg-black text-white px-8 py-3.5 rounded-full font-medium active:scale-95 transition-transform shadow-lg shadow-black/10"
          >
            สั่งเพิ่มอีกออเดอร์
          </button>
        </div>
      );
    }

    const activeDates = settings?.pickupDates?.filter((d) => d.isOpen) || [];
    // PromptPay QR URL (Standard Format via promptpay.io)
    const qrUrl =
      settings?.promptpayId && calculatedTotal > 0
        ? `https://promptpay.io/${settings.promptpayId}/${calculatedTotal}.png`
        : null;

    return (
      <div className="min-h-screen bg-[#FDFDFD] pb-10 font-sans selection:bg-gray-200 text-gray-900 flex flex-col relative">
        <div className="pt-12 pb-6 px-6 max-w-lg mx-auto w-full text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-black text-white rounded-full mb-4">
            <Store size={24} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            สั่งจองล่วงหน้า
          </h1>
          <p className="text-sm text-gray-500 bg-gray-50 inline-block px-4 py-1.5 rounded-full border border-gray-100">
            {settings?.announcement || 'ยินดีต้อนรับ'}
          </p>
        </div>

        <div className="px-5 max-w-md mx-auto w-full flex-1 space-y-6">
          {/* Section: Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 pl-1">
              ข้อมูลผู้สั่ง
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                className="w-full bg-white border border-gray-200/80 rounded-[20px] px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all shadow-sm"
                placeholder="ชื่อ-นามสกุล *"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
              <input
                type="tel"
                className="w-full bg-white border border-gray-200/80 rounded-[20px] px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all shadow-sm"
                placeholder="เบอร์โทรศัพท์ติดต่อ *"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
            </div>
          </div>

          {/* Section: Pickup Date */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 pl-1">
              เลือกรอบรับของ
            </h3>
            {activeDates.length === 0 ? (
              <div className="bg-red-50 text-red-600 text-sm p-4 rounded-[20px] border border-red-100 text-center">
                ขออภัยค่ะ ขณะนี้ยังไม่เปิดรับคิว
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {activeDates.map((dateObj) => {
                  const d = new Date(dateObj.date);
                  const shortDate = d.toLocaleDateString('th-TH', {
                    day: 'numeric',
                    month: 'short',
                  });
                  const isSelected =
                    formData.pickupDate === dateObj.date ||
                    (!formData.pickupDate &&
                      activeDates[0].date === dateObj.date);
                  return (
                    <button
                      key={dateObj.id}
                      onClick={() =>
                        setFormData({ ...formData, pickupDate: dateObj.date })
                      }
                      className={`p-3 rounded-[20px] text-left border transition-all ${
                        isSelected
                          ? 'border-black bg-black text-white shadow-md'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-semibold text-sm">
                        {dateObj.label}
                      </div>
                      <div
                        className={`text-xs mt-1 ${
                          isSelected ? 'text-gray-300' : 'text-gray-400'
                        }`}
                      >
                        {shortDate}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Menu */}
          <div className="space-y-4">
            <div className="flex justify-between items-end pl-1">
              <h3 className="text-sm font-semibold text-gray-900">
                รายการอาหาร
              </h3>
              <button
                onClick={() =>
                  setFormData({
                    ...formData,
                    items: [...formData.items, { menu: '', qty: '' }],
                  })
                }
                className="text-xs font-medium text-black bg-gray-100 px-3 py-1 rounded-full active:scale-95"
              >
                + เพิ่ม
              </button>
            </div>

            <div className="space-y-3 bg-white border border-gray-100 p-2 rounded-[24px] shadow-sm">
              {formData.items.map((item, i) => (
                <div key={i} className="flex gap-2 p-1">
                  <div className="flex-1 relative">
                    <select
                      className="w-full bg-gray-50 border-none rounded-2xl px-4 py-3.5 text-sm outline-none appearance-none font-medium text-gray-700"
                      value={item.menu}
                      onChange={(e) => {
                        const newItems = [...formData.items];
                        newItems[i].menu = e.target.value;
                        setFormData({ ...formData, items: newItems });
                      }}
                    >
                      <option value="" disabled>
                        เลือกเมนู
                      </option>
                      {settings?.menus?.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name} {m.price > 0 ? `(฿${m.price})` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
                      ▼
                    </div>
                  </div>

                  <input
                    type="number"
                    min="1"
                    className="w-20 bg-gray-50 border-none rounded-2xl px-2 py-3.5 text-center text-sm outline-none font-medium text-gray-700 placeholder:font-normal"
                    placeholder="จำนวน"
                    value={item.qty}
                    onChange={(e) => {
                      const newItems = [...formData.items];
                      newItems[i].qty = e.target.value;
                      setFormData({ ...formData, items: newItems });
                    }}
                  />

                  {formData.items.length > 1 && (
                    <button
                      onClick={() =>
                        setFormData({
                          ...formData,
                          items: formData.items.filter((_, idx) => idx !== i),
                        })
                      }
                      className="w-12 flex items-center justify-center text-gray-400 hover:text-red-500 bg-gray-50 rounded-2xl active:bg-gray-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}

              {/* Summary Total */}
              {calculatedTotal > 0 && (
                <div className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-2xl mt-2 border border-gray-100">
                  <span className="text-sm font-semibold text-gray-600">
                    ยอดชำระทั้งหมด:
                  </span>
                  <span className="text-lg font-bold text-black">
                    ฿{calculatedTotal.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Section: Payment / QR Code */}
          {calculatedTotal > 0 && settings?.promptpayId && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900 pl-1">
                ชำระเงิน (สแกนเพื่อจ่าย)
              </h3>
              <div className="bg-white border border-gray-200/80 rounded-[24px] p-6 text-center shadow-sm">
                <img
                  src={qrUrl}
                  alt="PromptPay QR Code"
                  className="mx-auto w-48 h-48 object-contain mb-4 rounded-xl border border-gray-100"
                />
                <p className="text-sm font-medium text-gray-800">
                  พร้อมเพย์: {settings.promptpayId}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  จำนวนเงิน{' '}
                  <span className="font-bold text-black">
                    ฿{calculatedTotal.toLocaleString()}
                  </span>
                </p>

                {/* Upload Slip */}
                <div className="mt-6 pt-5 border-t border-dashed border-gray-200">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />

                  {!slipPreview ? (
                    <button
                      onClick={() => fileInputRef.current.click()}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-blue-50 text-blue-600 rounded-xl text-sm font-semibold active:scale-95 transition-transform border border-blue-100"
                    >
                      <UploadCloud size={18} /> แนบสลิปโอนเงิน
                    </button>
                  ) : (
                    <div className="relative inline-block w-full">
                      <img
                        src={slipPreview}
                        alt="Slip Preview"
                        className="w-full h-40 object-cover rounded-xl border border-gray-200"
                      />
                      <button
                        onClick={() => {
                          setSlipPreview('');
                          setSlipFile(null);
                        }}
                        className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full backdrop-blur-md"
                      >
                        <X size={14} />
                      </button>
                      <div className="mt-2 text-xs text-green-600 font-medium flex justify-center items-center gap-1">
                        <CheckCircle2 size={14} /> แนบสลิปเรียบร้อยแล้ว
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section: Note */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 pl-1">
              หมายเหตุ
            </h3>
            <textarea
              className="w-full bg-white border border-gray-200/80 rounded-[20px] px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all shadow-sm min-h-[80px] resize-none placeholder:text-gray-400"
              placeholder="ระบุความต้องการพิเศษ (ถ้ามี)"
              value={formData.note}
              onChange={(e) =>
                setFormData({ ...formData, note: e.target.value })
              }
            />
          </div>

          <div className="pt-4 pb-8">
            <button
              onClick={handleSaveOrder}
              disabled={activeDates.length === 0 || isSubmitting}
              className="w-full bg-black text-white py-4 rounded-[20px] font-semibold text-sm shadow-xl shadow-black/10 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <>
                  ส่งคำสั่งจอง <ChevronLeft size={16} className="rotate-180" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Secret Admin Login Toggle */}
        <div className="py-6 text-center">
          <button
            onClick={() => setShowAdminLogin(true)}
            className="p-3 text-gray-300 hover:text-gray-400 transition-colors"
          >
            <Lock size={14} />
          </button>
        </div>

        {showAdminLogin && <AdminLoginOverlay />}
      </div>
    );
  }

  // --- ADMIN VIEW ---
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans max-w-md mx-auto border-x border-gray-100 relative">
      {/* Admin Header */}
      <div className="bg-white px-5 py-4 sticky top-0 z-20 border-b border-gray-100 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 tracking-tight">
            Admin System
          </h1>
        </div>
        <button
          onClick={() => setRole('guest')}
          className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full font-medium active:scale-95"
        >
          สลับเป็นลูกค้า
        </button>
      </div>

      {/* Admin Navigation */}
      <div className="flex bg-white border-b border-gray-100 px-1 pt-1">
        {[
          { id: 'dashboard', icon: Home, label: 'แดชบอร์ด' },
          { id: 'orders', icon: ListOrdered, label: 'ออเดอร์' },
          { id: 'settings', icon: Settings, label: 'ตั้งค่าร้าน' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 border-b-2 transition-all ${
              tab === t.id
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <t.icon size={20} strokeWidth={tab === t.id ? 2.5 : 2} />
            <span className="text-[10px] font-semibold">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {/* TAB 1: DASHBOARD */}
        {tab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-28">
                <div className="text-xs text-gray-500 font-medium">
                  รอรับของ
                </div>
                <div className="text-3xl font-semibold text-orange-500">
                  {upcomingOrders.length}
                </div>
              </div>
              <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-28">
                <div className="text-xs text-gray-500 font-medium">
                  ออเดอร์ทั้งหมด
                </div>
                <div className="text-3xl font-semibold text-gray-900">
                  {orders.filter((o) => o.status !== 'cancel').length}
                </div>
              </div>
              <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-28 col-span-2">
                <div className="text-xs text-gray-500 font-medium flex justify-between">
                  <span>ยอดมัดจำที่ยืนยันแล้ว (บาท)</span>
                  {unpaidOrders.length > 0 && (
                    <span className="text-red-500">
                      รอโอน {unpaidOrders.length} บิล
                    </span>
                  )}
                </div>
                <div className="text-3xl font-semibold text-green-600">
                  ฿{totalDeposit.toLocaleString()}
                </div>
              </div>
            </div>

            <button
              onClick={handleSyncToSheets}
              disabled={syncing}
              className={`w-full py-4 rounded-3xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm ${
                syncing
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-black text-white active:scale-95'
              }`}
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'กำลังส่งข้อมูล...' : 'Sync ไป Google Sheets'}
            </button>
          </div>
        )}

        {/* TAB 2: ORDERS LIST */}
        {tab === 'orders' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-1">
              {[
                { id: 'all', label: 'ทั้งหมด' },
                { id: 'pending', label: 'รอรับ' },
                { id: 'done', label: 'รับแล้ว' },
                { id: 'cancel', label: 'ยกเลิก' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterStatus(f.id)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    filterStatus === f.id
                      ? 'bg-black text-white shadow-md'
                      : 'bg-white text-gray-500 border border-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-3xl border border-dashed border-gray-200">
                  ไม่มีรายการ
                </div>
              ) : (
                filteredOrders.map((o) => (
                  <OrderCard key={o.id} order={o} onEdit={() => openModal(o)} />
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SETTINGS */}
        {tab === 'settings' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Payment & PromptPay */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Receipt size={16} /> บัญชีรับเงิน (PromptPay)
              </h3>
              <p className="text-xs text-gray-500">
                ระบุเบอร์โทรหรือบัตรประชาชน เพื่อสร้าง QR Code
                ให้ลูกค้าแสกนจ่ายอัตโนมัติ
              </p>
              <input
                type="text"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-black transition-colors"
                value={settings?.promptpayId || ''}
                onChange={(e) =>
                  handleUpdateSettings({
                    ...settings,
                    promptpayId: e.target.value,
                  })
                }
                placeholder="08XXXXXXXX หรือ 1XXXXXXXXXXXX"
              />
            </div>

            {/* Announcement */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">
                ประกาศหน้าร้าน
              </h3>
              <input
                type="text"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-black transition-colors"
                value={settings?.announcement || ''}
                onChange={(e) =>
                  handleUpdateSettings({
                    ...settings,
                    announcement: e.target.value,
                  })
                }
                placeholder="เช่น เปิดรับออเดอร์ถึง 18.00 น."
              />
            </div>

            {/* Pickup Dates */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-gray-900">
                  รอบวันจัดส่ง / รับของ
                </h3>
                <button
                  onClick={() => {
                    const newDates = [
                      ...(settings?.pickupDates || []),
                      {
                        id: Date.now().toString(),
                        date: new Date().toISOString().split('T')[0],
                        label: 'รอบใหม่',
                        isOpen: true,
                      },
                    ];
                    handleUpdateSettings({
                      ...settings,
                      pickupDates: newDates,
                    });
                  }}
                  className="text-xs bg-gray-100 font-semibold px-3 py-1.5 rounded-full"
                >
                  + เพิ่มรอบ
                </button>
              </div>
              <div className="space-y-3">
                {settings?.pickupDates?.map((d, index) => (
                  <div
                    key={d.id}
                    className="bg-gray-50 p-3 rounded-2xl border border-gray-200 flex flex-col gap-3"
                  >
                    <div className="flex gap-2">
                      <input
                        type="date"
                        className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs flex-1 outline-none"
                        value={d.date}
                        onChange={(e) => {
                          const newDates = [...settings.pickupDates];
                          newDates[index].date = e.target.value;
                          handleUpdateSettings({
                            ...settings,
                            pickupDates: newDates,
                          });
                        }}
                      />
                      <input
                        type="text"
                        className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs flex-1 outline-none"
                        value={d.label}
                        placeholder="ชื่อรอบ"
                        onChange={(e) => {
                          const newDates = [...settings.pickupDates];
                          newDates[index].label = e.target.value;
                          handleUpdateSettings({
                            ...settings,
                            pickupDates: newDates,
                          });
                        }}
                      />
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.isOpen}
                          onChange={(e) => {
                            const newDates = [...settings.pickupDates];
                            newDates[index].isOpen = e.target.checked;
                            handleUpdateSettings({
                              ...settings,
                              pickupDates: newDates,
                            });
                          }}
                          className="accent-black w-4 h-4"
                        />
                        เปิดรับออเดอร์
                      </label>
                      <button
                        onClick={() => {
                          if (confirm('ลบรอบนี้?'))
                            handleUpdateSettings({
                              ...settings,
                              pickupDates: settings.pickupDates.filter(
                                (x) => x.id !== d.id
                              ),
                            });
                        }}
                        className="text-xs text-red-500 font-medium p-1"
                      >
                        ลบ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Menus */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-gray-900">
                  รายการเมนู
                </h3>
                <button
                  onClick={() => {
                    const newMenus = [
                      ...(settings?.menus || []),
                      { id: Date.now().toString(), name: 'เมนูใหม่', price: 0 },
                    ];
                    handleUpdateSettings({ ...settings, menus: newMenus });
                  }}
                  className="text-xs bg-gray-100 font-semibold px-3 py-1.5 rounded-full"
                >
                  + เพิ่มเมนู
                </button>
              </div>
              <div className="space-y-2">
                {settings?.menus?.map((m, index) => (
                  <div key={m.id} className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm flex-1 outline-none focus:border-black"
                      value={m.name}
                      placeholder="ชื่อเมนู"
                      onChange={(e) => {
                        const newMenus = [...settings.menus];
                        newMenus[index].name = e.target.value;
                        handleUpdateSettings({ ...settings, menus: newMenus });
                      }}
                    />
                    <input
                      type="number"
                      className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-20 outline-none focus:border-black text-center"
                      value={m.price}
                      placeholder="ราคา"
                      onChange={(e) => {
                        const newMenus = [...settings.menus];
                        newMenus[index].price = e.target.value;
                        handleUpdateSettings({ ...settings, menus: newMenus });
                      }}
                    />
                    <button
                      onClick={() => {
                        if (confirm('ลบเมนูนี้?'))
                          handleUpdateSettings({
                            ...settings,
                            menus: settings.menus.filter((x) => x.id !== m.id),
                          });
                      }}
                      className="p-2.5 text-gray-400 hover:text-red-500 bg-gray-50 rounded-xl"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {tab === 'orders' && (
        <button
          onClick={() => openModal()}
          className="absolute bottom-6 right-6 w-14 h-14 bg-black text-white rounded-full shadow-xl flex items-center justify-center active:scale-90 transition-transform z-10"
        >
          <Plus size={28} />
        </button>
      )}

      {/* ADMIN EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FDFDFD] w-full max-w-md rounded-t-[32px] sm:rounded-[32px] h-[90vh] sm:h-auto sm:max-h-[90vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-[32px] sm:rounded-[32px] shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {editId ? 'แก้ไขออเดอร์' : 'เพิ่มออเดอร์ใหม่'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 bg-gray-50 hover:bg-gray-100 rounded-full text-gray-500 active:scale-95 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Slip Preview in Admin */}
              {slipPreview && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-900 mb-2">
                    สลิปการโอนเงิน
                  </label>
                  <a href={slipPreview} target="_blank" rel="noreferrer">
                    <img
                      src={slipPreview}
                      alt="Slip"
                      className="w-full h-32 object-cover rounded-2xl border border-gray-200 shadow-sm"
                    />
                  </a>
                </div>
              )}

              <div className="space-y-4">
                <input
                  type="text"
                  className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-black"
                  placeholder="ชื่อลูกค้า"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                />
                <div className="flex gap-3">
                  <input
                    type="tel"
                    className="flex-1 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-black"
                    placeholder="เบอร์โทร"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                  />
                  <input
                    type="date"
                    className="flex-1 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-black text-gray-600"
                    value={formData.pickupDate}
                    onChange={(e) =>
                      setFormData({ ...formData, pickupDate: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="bg-white p-4 rounded-[24px] border border-gray-200 space-y-3">
                <label className="block text-xs font-semibold text-gray-900 ml-1">
                  รายการเมนู
                </label>
                {formData.items.map((item, i) => (
                  <div key={i} className="flex gap-2">
                    <select
                      className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-3 py-3 text-sm outline-none"
                      value={item.menu}
                      onChange={(e) => {
                        const newItems = [...formData.items];
                        newItems[i].menu = e.target.value;
                        setFormData({ ...formData, items: newItems });
                      }}
                    >
                      <option value="">เลือกเมนู...</option>
                      {settings?.menus?.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      className="w-20 bg-gray-50 border border-gray-100 rounded-xl px-2 py-3 text-center text-sm outline-none"
                      placeholder="จำนวน"
                      value={item.qty}
                      onChange={(e) => {
                        const newItems = [...formData.items];
                        newItems[i].qty = e.target.value;
                        setFormData({ ...formData, items: newItems });
                      }}
                    />
                    <button
                      onClick={() =>
                        setFormData({
                          ...formData,
                          items: formData.items.filter((_, idx) => idx !== i),
                        })
                      }
                      className="p-3 text-gray-400 hover:text-red-500 bg-gray-50 rounded-xl"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setFormData({
                      ...formData,
                      items: [...formData.items, { menu: '', qty: '' }],
                    })
                  }
                  className="text-xs text-black font-semibold w-full py-3 mt-2 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  + เพิ่มรายการ
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-black"
                  value={formData.deposit}
                  onChange={(e) =>
                    setFormData({ ...formData, deposit: e.target.value })
                  }
                  placeholder="ยอดที่ยืนยันแล้ว (฿)"
                />
                <select
                  className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-black font-medium"
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value })
                  }
                >
                  <option value="pending">⏳ รอรับของ</option>
                  <option value="done">✅ รับแล้ว</option>
                  <option value="cancel">❌ ยกเลิก</option>
                </select>
              </div>

              <textarea
                className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-black resize-none h-24"
                value={formData.note}
                onChange={(e) =>
                  setFormData({ ...formData, note: e.target.value })
                }
                placeholder="หมายเหตุเพิ่มเติม..."
              />
            </div>

            <div className="p-5 bg-white border-t border-gray-100 pb-8 sm:pb-5 flex gap-3 shrink-0">
              {editId && (
                <button
                  onClick={() => handleDelete(editId)}
                  className="px-5 py-4 bg-red-50 text-red-600 rounded-2xl font-semibold text-sm flex-none active:scale-95 transition-transform"
                >
                  ลบ
                </button>
              )}
              <button
                onClick={handleSaveOrder}
                disabled={isSubmitting}
                className="flex-1 py-4 bg-black text-white rounded-2xl font-semibold text-sm shadow-xl shadow-black/10 active:scale-95 transition-transform flex justify-center items-center"
              >
                {isSubmitting ? (
                  <RefreshCw size={18} className="animate-spin" />
                ) : editId ? (
                  'บันทึกการแก้ไข'
                ) : (
                  'สร้างออเดอร์'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SUB-COMPONENTS ---
function OrderCard({ order, onEdit }) {
  const isDone = order.status === 'done';
  const isCancel = order.status === 'cancel';

  const statusColors = isDone
    ? 'bg-green-50 text-green-700 border-green-200'
    : isCancel
    ? 'bg-red-50 text-red-600 border-red-200'
    : 'bg-orange-50 text-orange-700 border-orange-200';
  const statusText = isDone ? 'รับแล้ว' : isCancel ? 'ยกเลิก' : 'รอรับ';

  const d = new Date(order.pickupDate || Date.now());
  const dateStr = order.pickupDate
    ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
    : 'ไม่ระบุ';

  return (
    <div
      className={`bg-white p-5 rounded-3xl border shadow-sm relative transition-all ${
        isCancel ? 'border-gray-100 opacity-70' : 'border-gray-200'
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-gray-900 text-base">
            {order.name}
          </h3>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            {order.phone || '-'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`text-[10px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider border ${statusColors}`}
          >
            {statusText}
          </span>
          <span className="text-xs font-semibold text-gray-700 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
            {dateStr}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        {(order.items || [])
          .filter((i) => i.menu)
          .map((i, idx) => (
            <div
              key={idx}
              className="flex justify-between items-center text-sm"
            >
              <span className="text-gray-600">{i.menu}</span>
              <span className="font-semibold text-gray-900 bg-gray-50 px-2 py-0.5 rounded-md">
                x{i.qty}
              </span>
            </div>
          ))}
        {order.totalPrice > 0 && (
          <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-dashed border-gray-200">
            <span className="text-gray-500 font-medium">ยอดรวม:</span>
            <span className="font-bold text-gray-900">
              ฿{order.totalPrice.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between items-end pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <div
            className={`text-xs font-bold ${
              order.deposit && parseFloat(order.deposit) > 0
                ? 'text-green-600'
                : 'text-orange-500'
            }`}
          >
            {order.deposit && parseFloat(order.deposit) > 0
              ? `จ่ายแล้ว ฿${parseFloat(order.deposit).toLocaleString()}`
              : 'ยังไม่ชำระ'}
          </div>
          {order.slipUrl && (
            <a
              href={order.slipUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-medium border border-blue-100"
            >
              <ImageIcon size={12} /> ดูสลิป
            </a>
          )}
        </div>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors active:scale-95"
        >
          <Edit3 size={12} /> แก้ไข
        </button>
      </div>
      {order.note && (
        <div className="mt-3 bg-yellow-50/50 p-2.5 rounded-xl text-[11px] text-gray-600 font-medium border border-yellow-100/50">
          📝 {order.note}
        </div>
      )}
    </div>
  );
}
