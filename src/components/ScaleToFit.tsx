import { useEffect, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  width?: number;
  height?: number;
  className?: string;
};

export default function ScaleToFit({
  children,
  width = 1920,
  height = 1080,
  className = "",
}: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function updateScale() {
      const scaleX = window.innerWidth / width;
      const scaleY = window.innerHeight / height;
      const nextScale = Math.min(scaleX, scaleY);

      setScale(nextScale);
      setOffset({
        x: Math.max(0, (window.innerWidth - width * nextScale) / 2),
        y: Math.max(0, (window.innerHeight - height * nextScale) / 2),
      });
    }

    updateScale();

    window.addEventListener("resize", updateScale);
    window.addEventListener("orientationchange", updateScale);

    return () => {
      window.removeEventListener("resize", updateScale);
      window.removeEventListener("orientationchange", updateScale);
    };
  }, [width, height]);

  return (
    <div className={`fixed inset-0 overflow-hidden bg-slate-950 ${className}`}>
      <div
        style={{
          width,
          height,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}