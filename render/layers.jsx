// Overlay layers: text, images, videos and solid boxes placed on the finished video (recordings) or on a scene
// (films), each with a box, opacity and rotation that keyframes can animate (render/keyframes.js).
// items: [{type, from, frames, x, y, w, h, opacity, rotation, keyframes, …}], from and frames in frames of the
// composition (or of the scene), url for an image or video, seconds for a video's length (it loops).
// frame: {width, height, scale} to draw into a box other than the whole video (a recording's layers inside a film
// scene), sizes in px times scale; without it, the video's own size.
import {Sequence, Img, Video, useCurrentFrame, useVideoConfig} from './frame.jsx';
import {layerAt} from './keyframes.js';

// Like the captions: Noto Sans JP or SC (shipped with the page when the text needs them) after Arial.
const font = 'Arial, "Noto Sans JP Variable", "Noto Sans SC Variable", sans-serif';

export function Layers({items = [], frame}) {
  return <>{items.map((layer, index) => <Sequence key={layer.id || index} from={layer.from} durationInFrames={layer.frames}>
    <Layer layer={layer} frame={frame}/>
  </Sequence>)}</>;
}

function Layer({layer, frame: area}) {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const {fps} = video;
  const {width, height, scale = 1} = area || video;
  const {x, y, w, h, opacity, rotation} = layerAt(layer, frame / fps);
  const radius = (layer.radius || 0) * scale;
  const box = {position: 'absolute', left: x * width, top: y * height, width: w * width, height: h * height, opacity: Math.max(0, Math.min(1, opacity)),
    transform: rotation ? `rotate(${rotation}deg)` : undefined, transformOrigin: 'center', borderRadius: radius, overflow: 'hidden'};
  if (layer.type === 'solid') return <div style={{...box, background: layer.color || '#18181b'}}/>;
  if (layer.type === 'image') return <div style={box}><Img src={layer.url} style={{width: '100%', height: '100%', objectFit: layer.fit || 'contain', display: 'block'}}/></div>;
  if (layer.type === 'video') return <div style={box}>
    <Video src={layer.url} muted loop loopSeconds={layer.seconds} objectFit={layer.fit || 'contain'} style={{width: '100%', height: '100%', display: 'block'}}/>
  </div>;
  // Text: wraps inside its box, centered top to bottom. size is the font size as a share of the video's height.
  const align = layer.align || 'center';
  return <div style={{...box, display: 'flex', alignItems: 'center', justifyContent: {left: 'flex-start', center: 'center', right: 'flex-end'}[align], overflow: 'visible',
    ...(layer.background && {background: layer.background, padding: `0 ${height * (layer.size || 0.05) * 0.6}px`})}}>
    <div data-check="text" style={{color: layer.color || '#fafafa', fontFamily: layer.font ? `${layer.font}, ${font}` : font, fontWeight: layer.weight || 600,
      fontSize: height * (layer.size || 0.05), lineHeight: 1.2, textAlign: align, whiteSpace: 'pre-wrap', width: '100%'}}>{layer.text}</div>
  </div>;
}
