/**
 * X-Whisper — Waveform Visualization
 * Siri-style fluid gradient blob equalizer that reacts to audio history.
 */

import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function Waveform() {
  const history = useAppStore((s) => s.amplitudeHistory);

  // Helper to generate a smooth closed path from history points for top and bottom mirroring
  const generateBlobPath = (
    data: number[],
    phaseShift: number,
    scale: number,
    noiseAmp: number
  ) => {
    const w = 200;
    const h = 50;
    const step = w / (data.length - 1 || 1);

    // Calculate top half points
    const topPoints = data.map((val, i) => {
      const x = i * step;
      // Window function to taper the edges so the blob starts/ends at a point
      const windowFunc = Math.sin((i / (data.length - 1)) * Math.PI);
      
      // Artificial noise to make it feel alive even at low volumes
      // We use phaseShift and i to create a pseudo-random fluid offset
      const noise = Math.sin((Date.now() / 200) + i * 0.4 + phaseShift) * noiseAmp;
      
      const v = Math.min(1, val * 5) * (h / 2) * windowFunc * scale + noise * windowFunc;
      return [x, h / 2 - v];
    });

    // Calculate bottom half points (mirrored)
    const bottomPoints = data.map((val, i) => {
      const x = i * step;
      const windowFunc = Math.sin((i / (data.length - 1)) * Math.PI);
      const noise = Math.sin((Date.now() / 250) - i * 0.5 - phaseShift) * noiseAmp;
      
      const v = Math.min(1, val * 5) * (h / 2) * windowFunc * scale + noise * windowFunc;
      return [x, h / 2 + v];
    }).reverse();

    // Smooth curve generator
    let d = `M ${topPoints[0][0]},${topPoints[0][1]} `;
    for (let i = 1; i < topPoints.length; i++) {
      const prev = topPoints[i - 1];
      const curr = topPoints[i];
      const cx = (prev[0] + curr[0]) / 2;
      d += `Q ${cx},${prev[1]} ${curr[0]},${curr[1]} `;
    }

    for (let i = 0; i < bottomPoints.length; i++) {
      const prev = i === 0 ? topPoints[topPoints.length - 1] : bottomPoints[i - 1];
      const curr = bottomPoints[i];
      const cx = (prev[0] + curr[0]) / 2;
      d += `Q ${cx},${prev[1]} ${curr[0]},${curr[1]} `;
    }

    d += ' Z';
    return d;
  };

  // We memoize the paths. Because the WebSocket triggers state updates every 50ms,
  // this component re-renders at ~20fps, driving the Date.now() fluid animation naturally
  // without needing a complex requestAnimationFrame loop.
  const path1 = useMemo(() => generateBlobPath(history, 0, 1.0, 4), [history]);
  const path2 = useMemo(() => generateBlobPath(history, 2, 0.7, 6), [history]);
  const path3 = useMemo(() => generateBlobPath(history, 4, 1.2, 3), [history]);

  return (
    <div className="flex items-center justify-center w-full h-[50px] relative overflow-hidden">
      {/* Siri-style glowing blur effect */}
      <div className="absolute inset-0 flex items-center justify-center mix-blend-screen opacity-90 blur-[4px]">
        <svg viewBox="0 0 200 50" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <defs>
            {/* Super vibrant glowing gradients typical of Siri animations */}
            <linearGradient id="siriPink" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ff2a5f" />
              <stop offset="100%" stopColor="#ff5e62" />
            </linearGradient>
            
            <linearGradient id="siriBlue" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1E90FF" />
              <stop offset="100%" stopColor="#8A2BE2" />
            </linearGradient>

            <linearGradient id="siriCyan" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00FFFF" />
              <stop offset="100%" stopColor="#00FF7F" />
            </linearGradient>
          </defs>

          {/* Three overlapping animated blobs */}
          <path d={path1} fill="url(#siriBlue)" className="opacity-80 transition-all duration-75 ease-linear" />
          <path d={path2} fill="url(#siriPink)" className="opacity-80 transition-all duration-75 ease-linear mix-blend-screen" />
          <path d={path3} fill="url(#siriCyan)" className="opacity-80 transition-all duration-75 ease-linear mix-blend-screen" />
        </svg>
      </div>
    </div>
  );
}
