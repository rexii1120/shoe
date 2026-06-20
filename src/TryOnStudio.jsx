import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Download,
  FlipHorizontal,
  Image as ImageIcon,
  Move,
  RotateCcw,
  Sparkles,
  Video
} from 'lucide-react';

const defaultTransform = {
  x: 110,
  y: 160,
  scale: 1,
  rotation: -18,
  opacity: 0.94,
  flip: false
};

function TryOnStudio({ shoes, initialShoeId, openCheckout, setToast }) {
  const [mode, setMode] = useState('photo');
  const [selectedShoeId, setSelectedShoeId] = useState(initialShoeId || shoes[0]?.id || '');
  const [photoUrl, setPhotoUrl] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraRequested, setCameraRequested] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [transform, setTransform] = useState(defaultTransform);
  const [dragging, setDragging] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const stageRef = useRef(null);
  const photoRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const dragStartRef = useRef(null);

  const selectedShoe = useMemo(
    () => shoes.find((shoe) => shoe.id === Number(selectedShoeId)) || shoes[0],
    [selectedShoeId, shoes]
  );

  const overlayWidth = Math.max(120, 270 * Number(transform.scale || 1));
  const overlayStyle = {
    width: `${overlayWidth}px`,
    left: `${transform.x}px`,
    top: `${transform.y}px`,
    opacity: transform.opacity,
    transform: `rotate(${transform.rotation}deg) scaleX(${transform.flip ? -1 : 1})`
  };

  useEffect(() => {
    if (initialShoeId) setSelectedShoeId(initialShoeId);
  }, [initialShoeId]);

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageSize({ width, height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [photoUrl, cameraOn, mode]);

  useEffect(() => {
    if (mode === 'video' && cameraRequested && videoRef.current && !cameraOn) {
      openCameraStream();
    }
  }, [mode, cameraRequested, cameraOn]);

  function resetPlacement() {
    const stage = stageRef.current?.getBoundingClientRect();
    const width = stage?.width || 680;
    const height = stage?.height || 460;
    setTransform({
      ...defaultTransform,
      x: Math.max(28, width * 0.23),
      y: Math.max(34, height * 0.43),
      scale: Math.max(0.55, Math.min(1.25, width / 720))
    });
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const nextUrl = URL.createObjectURL(file);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(nextUrl);
    setMode('photo');
    setTimeout(resetPlacement, 80);
  }

  function startCamera() {
    setMode('video');
    setCameraRequested(true);
  }

  async function openCameraStream() {
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setTimeout(resetPlacement, 120);
    } catch (error) {
      setCameraError('无法打开摄像头，请检查浏览器权限或改用上传照片。');
      setToast?.(error.message || '摄像头打开失败');
      setCameraOn(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraRequested(false);
    setCameraOn(false);
  }

  function beginDrag(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: transform.x,
      y: transform.y
    };
    setDragging(event.pointerId);
  }

  function moveDrag(event) {
    if (dragging !== event.pointerId || !dragStartRef.current) return;
    const start = dragStartRef.current;
    const stage = stageRef.current?.getBoundingClientRect();
    const nextX = start.x + event.clientX - start.pointerX;
    const nextY = start.y + event.clientY - start.pointerY;
    const maxX = stage ? stage.width - 80 : nextX;
    const maxY = stage ? stage.height - 60 : nextY;
    setTransform((current) => ({
      ...current,
      x: Math.max(-overlayWidth * 0.55, Math.min(maxX, nextX)),
      y: Math.max(-80, Math.min(maxY, nextY))
    }));
  }

  function endDrag(event) {
    if (dragging === event.pointerId) {
      setDragging(null);
      dragStartRef.current = null;
    }
  }

  async function exportComposite() {
    const source = mode === 'video' ? videoRef.current : photoRef.current;
    if (!source || !selectedShoe) {
      setToast?.('请先上传照片或打开摄像头');
      return;
    }

    const sourceWidth = mode === 'video' ? source.videoWidth : source.naturalWidth;
    const sourceHeight = mode === 'video' ? source.videoHeight : source.naturalHeight;
    if (!sourceWidth || !sourceHeight || !stageSize.width || !stageSize.height) {
      setToast?.('画面还没有准备好');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight);

    const shoeImage = await loadImage(selectedShoe.tryOnUrl || selectedShoe.imageUrl);
    const ratioX = sourceWidth / stageSize.width;
    const ratioY = sourceHeight / stageSize.height;
    const drawWidth = overlayWidth * ratioX;
    const drawHeight = drawWidth * (shoeImage.naturalHeight / shoeImage.naturalWidth);
    const centerX = (transform.x + overlayWidth / 2) * ratioX;
    const centerY = (transform.y + (overlayWidth * shoeImage.naturalHeight / shoeImage.naturalWidth) / 2) * ratioY;

    context.save();
    context.globalAlpha = transform.opacity;
    context.translate(centerX, centerY);
    context.rotate((transform.rotation * Math.PI) / 180);
    context.scale(transform.flip ? -1 : 1, 1);
    context.drawImage(shoeImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();

    const link = document.createElement('a');
    link.download = `court-kicks-tryon-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    setToast?.('试穿图片已生成');
  }

  return (
    <section className="page-section tryon-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">AR TRY-ON</p>
          <h2>篮球鞋 AR 试穿</h2>
        </div>
        <div className="segmented">
          <button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}><ImageIcon size={17} /> 图片</button>
          <button className={mode === 'video' ? 'active' : ''} onClick={startCamera}><Video size={17} /> 视频</button>
        </div>
      </div>

      <div className="tryon-layout">
        <div className="tryon-stage-card">
          <div className={`tryon-stage ${!photoUrl && mode === 'photo' ? 'is-empty' : ''}`} ref={stageRef}>
            {mode === 'photo' && photoUrl && (
              <img className="tryon-source" ref={photoRef} src={photoUrl} alt="脚部照片" onLoad={resetPlacement} />
            )}
            {mode === 'video' && (
              <video className="tryon-source" ref={videoRef} playsInline muted />
            )}
            {((mode === 'photo' && photoUrl) || (mode === 'video' && cameraOn)) && selectedShoe && (
              <img
                className={`tryon-overlay ${dragging ? 'is-dragging' : ''}`}
                src={selectedShoe.tryOnUrl || selectedShoe.imageUrl}
                alt={`${selectedShoe.name} 试穿叠层`}
                style={overlayStyle}
                draggable="false"
                onPointerDown={beginDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
            {mode === 'photo' && !photoUrl && (
              <div className="tryon-empty">
                <ImageIcon size={40} />
                <h3>上传或拍摄你的脚部照片</h3>
                <p>选择一张类似你发来的脚部照片，然后拖动鞋款对齐脚背。</p>
              </div>
            )}
            {mode === 'video' && !cameraOn && (
              <div className="tryon-empty">
                <Camera size={40} />
                <h3>打开摄像头实时预览</h3>
                <p>{cameraError || '允许浏览器使用摄像头后，可以在实时画面上调整鞋款位置。'}</p>
              </div>
            )}
          </div>
        </div>

        <aside className="tryon-panel">
          <div className="tryon-tool-block">
            <p className="eyebrow">SHOE</p>
            <h3>选择仓库鞋款</h3>
            <div className="tryon-shoe-list">
              {shoes.map((shoe) => (
                <button
                  type="button"
                  className={shoe.id === selectedShoe?.id ? 'active' : ''}
                  key={shoe.id}
                  onClick={() => setSelectedShoeId(shoe.id)}
                >
                  <img src={shoe.tryOnUrl || shoe.imageUrl} alt={shoe.name} />
                  <span>
                    <strong>{shoe.name}</strong>
                    <small>¥{shoe.dailyRate}/天</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="tryon-tool-block">
            <p className="eyebrow">INPUT</p>
            <div className="tryon-actions">
              <label className="upload-button">
                <ImageIcon size={18} />
                上传/拍照
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} />
              </label>
              <button className="ghost-button" type="button" onClick={cameraOn ? stopCamera : startCamera}>
                <Camera size={18} /> {cameraOn ? '关闭摄像头' : '打开摄像头'}
              </button>
            </div>
          </div>

          <div className="tryon-tool-block">
            <p className="eyebrow">ADJUST</p>
            <Control label="缩放" value={transform.scale} min="0.35" max="2.2" step="0.01" onChange={(value) => setTransform({ ...transform, scale: value })} />
            <Control label="旋转" value={transform.rotation} min="-80" max="80" step="1" onChange={(value) => setTransform({ ...transform, rotation: value })} />
            <Control label="透明度" value={transform.opacity} min="0.35" max="1" step="0.01" onChange={(value) => setTransform({ ...transform, opacity: value })} />
            <div className="tryon-actions">
              <button className="ghost-button" type="button" onClick={() => setTransform({ ...transform, flip: !transform.flip })}>
                <FlipHorizontal size={18} /> 镜像
              </button>
              <button className="ghost-button" type="button" onClick={resetPlacement}>
                <RotateCcw size={18} /> 重置
              </button>
            </div>
          </div>

          <div className="tryon-tool-block">
            <p className="eyebrow">OUTPUT</p>
            <button className="solid-button wide" type="button" onClick={exportComposite}>
              <Download size={18} /> 保存试穿图
            </button>
            {selectedShoe && (
              <button className="ghost-button wide-button" type="button" onClick={() => openCheckout(selectedShoe)}>
                <Sparkles size={18} /> 租这双鞋
              </button>
            )}
          </div>

          <div className="tryon-hint">
            <Move size={18} />
            <span>按住鞋子拖动，用滑块微调大小和角度。当前版本是手动校准试穿，适合图片和实时视频预览。</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Control({ label, value, min, max, step, onChange }) {
  return (
    <label className="range-control">
      <span>
        {label}
        <strong>{label === '旋转' ? `${Math.round(value)}°` : Number(value).toFixed(2)}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export default TryOnStudio;
