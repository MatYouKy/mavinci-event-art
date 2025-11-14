// components/ThumbnailHoverPopper.tsx
'use client';

import * as React from 'react';
import { Popper, Paper } from '@mui/material';
import { ImageIcon } from 'lucide-react';

type Props = {
  src?: string | null;
  alt?: string;
  size?: number;        // rozmiar miniatury w tabeli
  previewMax?: number;  // max rozmiar podglądu
  className?: string;
  nullIcon?: React.ReactNode;
};

export const ThumbnailHoverPopper: React.FC<Props> = ({
  src,
  alt = 'image',
  size = 36,
  previewMax = 260,
  className,
  nullIcon,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const enterTimer = React.useRef<number | null>(null);
  const leaveTimer = React.useRef<number | null>(null);

  let srcUrl = src;
  if (src?.startsWith('/')) {
    srcUrl = `${process.env.NEXT_PUBLIC_SERVER_URL}${src}`;
  } else {
    srcUrl = src;
  }

  const handleEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!src) return;
    setAnchorEl(e.currentTarget);
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    enterTimer.current = window.setTimeout(() => setOpen(true), 80);
  };

  const handleLeave = () => {
    if (enterTimer.current) window.clearTimeout(enterTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  React.useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  const imgNode = src ? (
    <div
    onMouseEnter={handleEnter}
    onMouseLeave={handleLeave}
    className={className}
    style={{
      width: size,               // 36
      height: size,              // 36
      border: '1px solid rgba(211,187,115,0.1)',
      borderRadius: 6,
      overflow: 'hidden',
      background: '#0f1119',
      display: 'inline-block',
      lineHeight: 0,   
      cursor: 'pointer',
    }}
  >
    <img
      src={srcUrl}
      alt={alt}
      draggable={false}
      loading="lazy"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',      // klucz: zawsze wypełnia 36×36
        display: 'block',
      }}
    />
  </div>
  ) : (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="flex items-center justify-center rounded border"
      style={{
        width: size,
        height: size,
        backgroundColor: '#0f1119',
        borderColor: 'rgba(211,187,115,0.2)',
        color: 'rgba(229,228,226,0.4)',
        fontSize: 14,
      }}
    >
     {nullIcon ? nullIcon : <ImageIcon className={`h-${size / 5.5} w-${size / 5.5} text-[#e5e4e2]/20`} />}
    </div>
  );

  return (
    <>
      {imgNode}

      <Popper
        open={open && !!src}
        anchorEl={anchorEl}
        placement="right"
        modifiers={[
          { name: 'offset', options: { offset: [10, 0] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
        sx={{ zIndex: 1600 }} // nad tabelą
        onMouseEnter={() => {
          if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
        }}
        onMouseLeave={handleLeave}
      >
        <Paper
          elevation={8}
          sx={{
            p: 0.5,
            backgroundColor: '#0f1119',
            border: '1px solid rgba(211,187,115,0.3)',
            cursor: 'pointer',
          }}
        >
          {src && (
            <img
              src={srcUrl}
              alt={alt}
              className="rounded-lg object-contain"
              style={{ maxWidth: previewMax, maxHeight: previewMax }}
              draggable={false}
            />
          )}
        </Paper>
      </Popper>
    </>
  );
};