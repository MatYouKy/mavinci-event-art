import { useCallback, useEffect, useRef, useState } from 'react';

export type DropdownAlign = 'left' | 'right';
export type DropdownWidth = 'auto' | 'trigger' | number;

export type DropdownPosition = {
  top: number;
  left: number;
  width?: number;
};

type UsePortalDropdownOptions = {
  menuWidth?: number;
  width?: DropdownWidth;
  align?: DropdownAlign;
  offsetY?: number;
  closeOnScroll?: boolean;
};

export const usePortalDropdown = (options?: UsePortalDropdownOptions) => {
  const offsetY = options?.offsetY ?? 4;
  const width: DropdownWidth = options?.width ?? options?.menuWidth ?? 160;
  const align: DropdownAlign = options?.align ?? 'right';
  const closeOnScroll = options?.closeOnScroll ?? false;

  const [openId, setOpenId] = useState<string | null>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const anchorRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpenId(null);
    setPosition(null);
    anchorRef.current = null;
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();

    const resolvedWidth =
      width === 'trigger'
        ? rect.width
        : typeof width === 'number'
          ? width
          : undefined;

    const left =
      align === 'right' && resolvedWidth
        ? rect.right - resolvedWidth
        : rect.left;

    setPosition({
      top: rect.bottom + offsetY,
      left,
      width: resolvedWidth,
    });
  }, [align, offsetY, width]);

  const open = useCallback(
    (id: string, anchor: HTMLElement) => {
      anchorRef.current = anchor;
      setOpenId(id);
      updatePosition();
    },
    [updatePosition],
  );

  const toggle = useCallback(
    (id: string, event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();

      if (openId === id) {
        close();
        return;
      }

      anchorRef.current = event.currentTarget;
      setOpenId(id);
      updatePosition();
    },
    [close, openId, updatePosition],
  );

  useEffect(() => {
    if (!openId) return;

    const handleClickOutside = () => close();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    const handleScrollOrResize = () => {
      if (closeOnScroll) close();
      else updatePosition();
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [openId, close, updatePosition, closeOnScroll]);

  return {
    openId,
    position,
    isOpen: Boolean(openId && position),
    open,
    toggle,
    close,
    updatePosition,
  };
};