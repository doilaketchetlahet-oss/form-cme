"use client";
import { useState } from "react";
import { Reorder, useDragControls, useMotionValue } from "framer-motion";

interface Props {
  item: unknown;
  children: (props: { onDragStart: (e: React.PointerEvent) => void; isDragging: boolean }) => React.ReactNode;
}

export function SortableGenericItem({ item, children }: Props) {
  const controls = useDragControls();
  const y = useMotionValue(0);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      style={{ y }}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      className="relative"
    >
      {children({
        onDragStart: (e) => { e.preventDefault(); controls.start(e); },
        isDragging,
      })}
    </Reorder.Item>
  );
}
