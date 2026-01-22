'use client';

import { Provider } from 'react-redux';
import { useRef } from 'react';
import { api } from './api/api';
import { makeStore } from './store';


export default function RTKHydrate({
  children,
  preloadedState,
}: {
  children: React.ReactNode;
  preloadedState: any;
}) {
  const storeRef = useRef<any>(null);

  if (!storeRef.current) {
    storeRef.current = makeStore(preloadedState);
  }

  return <Provider store={storeRef.current}>{children}</Provider>;
}