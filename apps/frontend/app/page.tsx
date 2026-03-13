'use client';

import React, { Suspense } from 'react';
import HomeSimple from '../components/HomeSimple';

export default function Page() {
  return (
    <Suspense>
      <HomeSimple />
    </Suspense>
  );
}
