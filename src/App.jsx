import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CreditCard,
  Edit3,
  LogOut,
  PackageCheck,
  Plus,
  Save,
  Search,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  X
} from 'lucide-react';
import TryOnStudio from './TryOnStudio.jsx';

const apiBase = '/api';
const authKey = 'court_kicks_auth';

const statusOptions = [
  ['paid', '已支付待发货'],
  ['shipped', '已发货'],
  ['active', '租赁中'],
  ['returned', '已归还'],
  ['completed', '已完成'],
  ['cancelled', '已取消']
];

const emptyShoeForm = {
  name: '',
  brand: '',
  category: '后卫速度型',
  description: '',
  imageUrl: '/assets/shoes/apex-nova.svg',
  dailyRate: 39,
  deposit: 299,
  rating: 4.8,
  tags: '轻量,速度',
  isActive: true,
  inventory: [
    { size: '40', totalQty: 1, availableQty: 1 },
    { size: '41', totalQty: 1, availableQty: 1 },
    { size: '42', totalQty: 1, availableQty: 1 }
  ]
};

function App() {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem(authKey);
    return saved ? JSON.parse(saved) : null;
  });
  const [view, setView] = useState('catalog');
  const [authMode, setAuthMode] = useState(null);
  const [shoes, setShoes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [adminShoes, setAdminShoes] = useState([]);
  const [adminOrders, setAdminOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [selectedShoe, setSelectedShoe] = useState(null);
  const [checkout, setCheckout] = useState(defaultCheckout());
  const [tryOnShoeId, setTryOnShoeId] = useState(null);
  const [shoeForm, setShoeForm] = useState(emptyShoeForm);
  const [editingShoeId, setEditingShoeId] = useState(null);
  const [adminTab, setAdminTab] = useState('orders');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  const token = auth?.token;
  const user = auth?.user;
  const isAdmin = user?.role === 'admin';

  const categories = useMemo(() => {
    const values = new Set(shoes.map((shoe) => shoe.category));
    return ['全部', ...values];
  }, [shoes]);

  useEffect(() => {
    loadShoes();
  }, []);

  useEffect(() => {
    if (token) {
      loadOrders();
    } else {
      setOrders([]);
    }
  }, [token]);

  useEffect(() => {
    if (token && isAdmin && view === 'admin') {
      loadAdminData();
    }
  }, [token, isAdmin, view]);

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '请求失败');
    }
    return payload;
  }

  async function loadShoes() {
    const params = new URLSearchParams();
    if (query.trim()) params.set('search', query.trim());
    if (category !== '全部') params.set('category', category);
    const payload = await request(`/shoes${params.toString() ? `?${params}` : ''}`);
    setShoes(payload.shoes);
  }

  async function loadOrders() {
    const payload = await request('/orders');
    setOrders(payload.orders);
  }

  async function loadAdminData() {
    const [summaryPayload, ordersPayload, shoesPayload] = await Promise.all([
      request('/admin/summary'),
      request('/admin/orders'),
      request('/admin/shoes')
    ]);
    setSummary(summaryPayload);
    setAdminOrders(ordersPayload.orders);
    setAdminShoes(shoesPayload.shoes);
  }

  async function handleAuthSubmit(event, form) {
    event.preventDefault();
    setLoading(true);
    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      const payload = await request(endpoint, {
        method: 'POST',
        body: JSON.stringify(form)
      });
      localStorage.setItem(authKey, JSON.stringify(payload));
      setAuth(payload);
      setAuthMode(null);
      setToast(payload.user.role === 'admin' ? '管理员已登录' : '登录成功');
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(authKey);
    setAuth(null);
    setView('catalog');
    setToast('已退出登录');
  }

  function openCheckout(shoe) {
    if (!token) {
      setAuthMode('login');
      setToast('请先登录后租赁');
      return;
    }
    setSelectedShoe(shoe);
    const firstSize = shoe.inventory.find((item) => item.availableQty > 0)?.size || shoe.inventory[0]?.size || '';
    setCheckout({ ...defaultCheckout(), size: firstSize, customerName: user.name });
  }

  function openTryOn(shoe) {
    setTryOnShoeId(shoe?.id || null);
    setView('tryon');
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!selectedShoe) return;
    setLoading(true);
    try {
      const payload = await request('/orders', {
        method: 'POST',
        body: JSON.stringify({
          shoeId: selectedShoe.id,
          ...checkout
        })
      });
      setToast(`订单 ${payload.order.orderNumber} 已模拟支付`);
      setSelectedShoe(null);
      setView('orders');
      await Promise.all([loadShoes(), loadOrders()]);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelOrder(orderId) {
    setLoading(true);
    try {
      await request(`/orders/${orderId}/cancel`, { method: 'POST' });
      setToast('订单已取消');
      await Promise.all([loadOrders(), loadShoes()]);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateOrderStatus(orderId, status) {
    setLoading(true);
    try {
      await request(`/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      setToast('订单状态已更新');
      await Promise.all([loadAdminData(), loadShoes()]);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveShoe(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...shoeForm,
        dailyRate: Number(shoeForm.dailyRate),
        deposit: Number(shoeForm.deposit),
        rating: Number(shoeForm.rating),
        inventory: shoeForm.inventory.map((item) => ({
          ...item,
          totalQty: Number(item.totalQty),
          availableQty: Number(item.availableQty)
        }))
      };

      if (editingShoeId) {
        await request(`/admin/shoes/${editingShoeId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setToast('鞋款已更新');
      } else {
        await request('/admin/shoes', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setToast('鞋款已新增');
      }

      setShoeForm(emptyShoeForm);
      setEditingShoeId(null);
      await Promise.all([loadAdminData(), loadShoes()]);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  function editShoe(shoe) {
    setEditingShoeId(shoe.id);
    setAdminTab('shoes');
    setShoeForm({
      name: shoe.name,
      brand: shoe.brand,
      category: shoe.category,
      description: shoe.description,
      imageUrl: shoe.imageUrl,
      dailyRate: shoe.dailyRate,
      deposit: shoe.deposit,
      rating: shoe.rating,
      tags: shoe.tags.join(','),
      isActive: shoe.isActive,
      inventory: shoe.inventory.map((item) => ({
        size: item.size,
        totalQty: item.totalQty,
        availableQty: item.availableQty
      }))
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView('catalog')}>
          <span className="brand-mark">CK</span>
          <span>
            <strong>Court Kicks</strong>
            <small>篮球鞋租赁</small>
          </span>
        </button>

        <nav className="nav-tabs" aria-label="主导航">
          <button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}>
            <ShoppingBag size={18} /> 鞋库
          </button>
          <button className={view === 'orders' ? 'active' : ''} onClick={() => token ? setView('orders') : setAuthMode('login')}>
            <PackageCheck size={18} /> 订单
          </button>
          <button className={view === 'tryon' ? 'active' : ''} onClick={() => setView('tryon')}>
            <Sparkles size={18} /> AR 试穿
          </button>
          {isAdmin && (
            <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
              <Shield size={18} /> 后台
            </button>
          )}
        </nav>

        <div className="account-actions">
          {user ? (
            <>
              <span className="account-pill"><User size={16} /> {user.name}</span>
              <button className="icon-button" title="退出登录" onClick={logout}><LogOut size={18} /></button>
            </>
          ) : (
            <>
              <button className="ghost-button" onClick={() => setAuthMode('login')}>登录</button>
              <button className="solid-button" onClick={() => setAuthMode('register')}>注册</button>
            </>
          )}
        </div>
      </header>

      {toast && (
        <div className="toast" role="status">
          {toast}
          <button title="关闭" onClick={() => setToast('')}><X size={16} /></button>
        </div>
      )}

      <main>
        {view === 'catalog' && (
          <Catalog
            shoes={shoes}
            query={query}
            setQuery={setQuery}
            category={category}
            setCategory={setCategory}
            categories={categories}
            loadShoes={loadShoes}
            openCheckout={openCheckout}
            openTryOn={openTryOn}
          />
        )}

        {view === 'tryon' && (
          <TryOnStudio
            shoes={shoes}
            initialShoeId={tryOnShoeId}
            openCheckout={openCheckout}
            setToast={setToast}
          />
        )}

        {view === 'orders' && (
          <OrdersView
            orders={orders}
            cancelOrder={cancelOrder}
            openLogin={() => setAuthMode('login')}
            user={user}
          />
        )}

        {view === 'admin' && isAdmin && (
          <AdminView
            summary={summary}
            orders={adminOrders}
            shoes={adminShoes}
            adminTab={adminTab}
            setAdminTab={setAdminTab}
            updateOrderStatus={updateOrderStatus}
            shoeForm={shoeForm}
            setShoeForm={setShoeForm}
            saveShoe={saveShoe}
            editShoe={editShoe}
            editingShoeId={editingShoeId}
            resetShoeForm={() => {
              setEditingShoeId(null);
              setShoeForm(emptyShoeForm);
            }}
          />
        )}
      </main>

      {authMode && (
        <AuthModal
          mode={authMode}
          setMode={setAuthMode}
          onSubmit={handleAuthSubmit}
          loading={loading}
        />
      )}

      {selectedShoe && (
        <CheckoutModal
          shoe={selectedShoe}
          checkout={checkout}
          setCheckout={setCheckout}
          onClose={() => setSelectedShoe(null)}
          onSubmit={submitOrder}
          loading={loading}
        />
      )}
    </div>
  );
}

function Catalog({ shoes, query, setQuery, category, setCategory, categories, loadShoes, openCheckout, openTryOn }) {
  const totalAvailable = shoes.reduce(
    (sum, shoe) => sum + shoe.inventory.reduce((inner, item) => inner + item.availableQty, 0),
    0
  );

  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">HOOP RENTAL</p>
          <h1>Court Kicks</h1>
          <p className="hero-copy">按天租赁实战篮球鞋，尺码库存实时可见，押金和租金一单结清。</p>
          <div className="hero-actions">
            <button className="solid-button large" onClick={() => document.getElementById('shoe-grid')?.scrollIntoView({ behavior: 'smooth' })}>
              <ShoppingBag size={19} /> 立即租鞋
            </button>
            <button className="ghost-button large" onClick={() => openTryOn(shoes[0])}>
              <Sparkles size={19} /> AR 试穿
            </button>
            <span className="hero-metric">{totalAvailable} 双可租</span>
          </div>
        </div>
      </section>

      <section className="catalog-shell" id="shoe-grid">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AVAILABLE NOW</p>
            <h2>实战鞋库</h2>
          </div>
          <form className="filters" onSubmit={(event) => { event.preventDefault(); loadShoes(); }}>
            <label className="search-box">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索鞋款、品牌、标签" />
            </label>
            <label className="select-box">
              <SlidersHorizontal size={18} />
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <button className="solid-button" type="submit">筛选</button>
          </form>
        </div>

        <div className="shoe-grid">
          {shoes.map((shoe) => (
            <ShoeCard key={shoe.id} shoe={shoe} openCheckout={openCheckout} openTryOn={openTryOn} />
          ))}
        </div>
      </section>
    </>
  );
}

function ShoeCard({ shoe, openCheckout, openTryOn }) {
  const available = shoe.inventory.reduce((sum, item) => sum + item.availableQty, 0);

  return (
    <article className="shoe-card">
      <div className="shoe-image-wrap">
        <img src={shoe.imageUrl} alt={`${shoe.brand} ${shoe.name}`} />
        <span className={available > 0 ? 'stock-badge' : 'stock-badge empty'}>
          {available > 0 ? `${available} 双可租` : '暂无库存'}
        </span>
      </div>
      <div className="shoe-card-body">
        <div className="shoe-title-row">
          <div>
            <p>{shoe.brand}</p>
            <h3>{shoe.name}</h3>
          </div>
          <span className="rating">{shoe.rating.toFixed(1)}</span>
        </div>
        <p className="shoe-description">{shoe.description}</p>
        <div className="tag-row">
          {shoe.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="inventory-row">
          {shoe.inventory.map((item) => (
            <span key={item.size} className={item.availableQty > 0 ? '' : 'disabled'}>
              {item.size}
            </span>
          ))}
        </div>
        <div className="card-footer">
          <div>
            <strong>¥{shoe.dailyRate}</strong>
            <small>/天 · 押金 ¥{shoe.deposit}</small>
          </div>
          <div className="card-actions">
            <button className="icon-button" title="AR 试穿" onClick={() => openTryOn(shoe)}>
              <Sparkles size={18} />
            </button>
            <button className="solid-button" disabled={!available} onClick={() => openCheckout(shoe)}>
              <CreditCard size={18} /> 租赁
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function OrdersView({ orders, cancelOrder, openLogin, user }) {
  if (!user) {
    return (
      <section className="empty-state">
        <ShoppingBag size={36} />
        <h2>登录后查看订单</h2>
        <button className="solid-button" onClick={openLogin}>登录</button>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MY RENTALS</p>
          <h2>我的订单</h2>
        </div>
      </div>
      <div className="order-list">
        {orders.length === 0 && <p className="muted">暂无订单</p>}
        {orders.map((order) => (
          <article className="order-card" key={order.id}>
            <img src={order.item.imageUrl} alt={order.item.shoeName} />
            <div className="order-main">
              <div className="order-title">
                <div>
                  <p>{order.orderNumber}</p>
                  <h3>{order.item.shoeBrand} {order.item.shoeName}</h3>
                </div>
                <span className={`status status-${order.status}`}>{order.statusLabel}</span>
              </div>
              <div className="order-meta">
                <span><CalendarDays size={16} /> {order.rentalStart} 至 {order.rentalEnd}</span>
                <span>尺码 {order.item.size}</span>
                <span>{order.rentalDays} 天</span>
                <span>¥{order.total}</span>
              </div>
            </div>
            {['paid', 'shipped'].includes(order.status) && (
              <button className="ghost-button danger" onClick={() => cancelOrder(order.id)}>取消</button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminView({
  summary,
  orders,
  shoes,
  adminTab,
  setAdminTab,
  updateOrderStatus,
  shoeForm,
  setShoeForm,
  saveShoe,
  editShoe,
  editingShoeId,
  resetShoeForm
}) {
  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h2>运营后台</h2>
        </div>
        <div className="segmented">
          <button className={adminTab === 'orders' ? 'active' : ''} onClick={() => setAdminTab('orders')}>订单</button>
          <button className={adminTab === 'shoes' ? 'active' : ''} onClick={() => setAdminTab('shoes')}>鞋款</button>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="上架鞋款" value={summary?.totalShoes ?? 0} />
        <Stat label="进行中订单" value={summary?.activeOrders ?? 0} />
        <Stat label="租金收入" value={`¥${summary?.revenue ?? 0}`} />
        <Stat label="低库存尺码" value={summary?.lowStock ?? 0} />
      </div>

      {adminTab === 'orders' ? (
        <div className="admin-table">
          {orders.map((order) => (
            <article className="admin-order-row" key={order.id}>
              <img src={order.item.imageUrl} alt={order.item.shoeName} />
              <div>
                <p>{order.orderNumber} · {order.user.name}</p>
                <h3>{order.item.shoeName} / {order.item.size}</h3>
                <span>{order.rentalStart} 至 {order.rentalEnd} · ¥{order.total}</span>
              </div>
              <select value={order.status} onChange={(event) => updateOrderStatus(order.id, event.target.value)}>
                {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </article>
          ))}
        </div>
      ) : (
        <div className="admin-shoes-layout">
          <ShoeForm
            form={shoeForm}
            setForm={setShoeForm}
            onSubmit={saveShoe}
            editingShoeId={editingShoeId}
            resetShoeForm={resetShoeForm}
          />
          <div className="admin-shoe-list">
            {shoes.map((shoe) => (
              <article className="admin-shoe-row" key={shoe.id}>
                <img src={shoe.imageUrl} alt={shoe.name} />
                <div>
                  <p>{shoe.brand}</p>
                  <h3>{shoe.name}</h3>
                  <span>{shoe.isActive ? '上架中' : '已下架'} · ¥{shoe.dailyRate}/天</span>
                </div>
                <button className="icon-button" title="编辑鞋款" onClick={() => editShoe(shoe)}>
                  <Edit3 size={18} />
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ShoeForm({ form, setForm, onSubmit, editingShoeId, resetShoeForm }) {
  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateInventory(index, field, value) {
    setForm((current) => ({
      ...current,
      inventory: current.inventory.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      ))
    }));
  }

  function addInventoryRow() {
    setForm((current) => ({
      ...current,
      inventory: [...current.inventory, { size: '', totalQty: 1, availableQty: 1 }]
    }));
  }

  function removeInventoryRow(index) {
    setForm((current) => ({
      ...current,
      inventory: current.inventory.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <div className="form-header">
        <h3>{editingShoeId ? '编辑鞋款' : '新增鞋款'}</h3>
        {editingShoeId && <button className="ghost-button" type="button" onClick={resetShoeForm}>新建</button>}
      </div>

      <div className="form-grid">
        <label>名称<input value={form.name} onChange={(event) => updateField('name', event.target.value)} /></label>
        <label>品牌<input value={form.brand} onChange={(event) => updateField('brand', event.target.value)} /></label>
        <label>分类<input value={form.category} onChange={(event) => updateField('category', event.target.value)} /></label>
        <label>图片路径<input value={form.imageUrl} onChange={(event) => updateField('imageUrl', event.target.value)} /></label>
        <label>日租金<input type="number" min="1" value={form.dailyRate} onChange={(event) => updateField('dailyRate', event.target.value)} /></label>
        <label>押金<input type="number" min="0" value={form.deposit} onChange={(event) => updateField('deposit', event.target.value)} /></label>
        <label>评分<input type="number" min="0" max="5" step="0.1" value={form.rating} onChange={(event) => updateField('rating', event.target.value)} /></label>
        <label>标签<input value={form.tags} onChange={(event) => updateField('tags', event.target.value)} /></label>
      </div>
      <label className="full-label">描述<textarea rows="3" value={form.description} onChange={(event) => updateField('description', event.target.value)} /></label>
      <label className="check-label">
        <input type="checkbox" checked={form.isActive} onChange={(event) => updateField('isActive', event.target.checked)} />
        上架
      </label>

      <div className="inventory-editor">
        <div className="form-header">
          <h4>尺码库存</h4>
          <button type="button" className="icon-button" title="新增尺码" onClick={addInventoryRow}><Plus size={18} /></button>
        </div>
        {form.inventory.map((item, index) => (
          <div className="inventory-edit-row" key={`${item.size}-${index}`}>
            <label>尺码<input value={item.size} onChange={(event) => updateInventory(index, 'size', event.target.value)} /></label>
            <label>总库存<input type="number" min="0" value={item.totalQty} onChange={(event) => updateInventory(index, 'totalQty', event.target.value)} /></label>
            <label>可租<input type="number" min="0" value={item.availableQty} onChange={(event) => updateInventory(index, 'availableQty', event.target.value)} /></label>
            <button type="button" className="icon-button danger" title="删除尺码" onClick={() => removeInventoryRow(index)}>
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      <button className="solid-button wide" type="submit"><Save size={18} /> 保存鞋款</button>
    </form>
  );
}

function AuthModal({ mode, setMode, onSubmit, loading }) {
  const [form, setForm] = useState({
    name: '',
    email: mode === 'login' ? 'user@court.local' : '',
    password: mode === 'login' ? 'user123' : ''
  });

  useEffect(() => {
    setForm({
      name: '',
      email: mode === 'login' ? 'user@court.local' : '',
      password: mode === 'login' ? 'user123' : ''
    });
  }, [mode]);

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-panel auth-panel" onSubmit={(event) => onSubmit(event, form)}>
        <button type="button" className="modal-close" title="关闭" onClick={() => setMode(null)}><X size={20} /></button>
        <p className="eyebrow">{mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}</p>
        <h2>{mode === 'login' ? '登录账户' : '注册账户'}</h2>
        {mode === 'register' && (
          <label>姓名<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        )}
        <label>邮箱<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>密码<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <button className="solid-button wide" disabled={loading} type="submit">
          <User size={18} /> {mode === 'login' ? '登录' : '注册'}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? '创建新账户' : '已有账户登录'}
        </button>
        <p className="demo-account">管理员：admin@court.local / admin123</p>
      </form>
    </div>
  );
}

function CheckoutModal({ shoe, checkout, setCheckout, onClose, onSubmit, loading }) {
  const selectedInventory = shoe.inventory.find((item) => item.size === checkout.size);
  const rentalDays = getRentalDays(checkout.rentalStart, checkout.rentalEnd);
  const subtotal = rentalDays * shoe.dailyRate;
  const total = subtotal + shoe.deposit;

  function update(field, value) {
    setCheckout((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-panel checkout-panel" onSubmit={onSubmit}>
        <button type="button" className="modal-close" title="关闭" onClick={onClose}><X size={20} /></button>
        <div className="checkout-product">
          <img src={shoe.imageUrl} alt={shoe.name} />
          <div>
            <p>{shoe.brand}</p>
            <h2>{shoe.name}</h2>
            <span>¥{shoe.dailyRate}/天 · 押金 ¥{shoe.deposit}</span>
          </div>
        </div>

        <div className="size-picker" role="radiogroup" aria-label="尺码">
          {shoe.inventory.map((item) => (
            <button
              type="button"
              key={item.size}
              className={checkout.size === item.size ? 'active' : ''}
              disabled={item.availableQty === 0}
              onClick={() => update('size', item.size)}
            >
              {item.size}
              <small>{item.availableQty}</small>
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label>开始日期<input type="date" value={checkout.rentalStart} onChange={(event) => update('rentalStart', event.target.value)} /></label>
          <label>结束日期<input type="date" value={checkout.rentalEnd} onChange={(event) => update('rentalEnd', event.target.value)} /></label>
          <label>收货人<input value={checkout.customerName} onChange={(event) => update('customerName', event.target.value)} /></label>
          <label>电话<input value={checkout.phone} onChange={(event) => update('phone', event.target.value)} /></label>
        </div>
        <label className="full-label">配送地址<textarea rows="3" value={checkout.address} onChange={(event) => update('address', event.target.value)} /></label>

        <div className="checkout-total">
          <span>尺码 {checkout.size} · 库存 {selectedInventory?.availableQty ?? 0}</span>
          <strong>¥{Number.isFinite(total) ? total : shoe.deposit}</strong>
        </div>
        <button className="solid-button wide" disabled={loading} type="submit">
          <CreditCard size={18} /> 提交并模拟支付
        </button>
      </form>
    </div>
  );
}

function defaultCheckout() {
  const start = new Date();
  const end = new Date();
  end.setDate(start.getDate() + 2);
  return {
    size: '',
    rentalStart: toDateInput(start),
    rentalEnd: toDateInput(end),
    customerName: '',
    phone: '13800000000',
    address: '上海市徐汇区球场路 88 号'
  };
}

function getRentalDays(startValue, endValue) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default App;
