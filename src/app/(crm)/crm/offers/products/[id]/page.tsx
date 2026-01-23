import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailPage';
import { getProductPageData } from '@/lib/CRM/Offers/getProductIdData';
import { IEventCategory } from '../../../event-categories/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProductPage({ params }: { params: { id: string } }) {
  const { product, categories } = await getProductPageData(params.id);

  if (params.id !== 'new' && !product) notFound();

  return <ProductDetailClient initialProduct={product} initialCategories={categories as IEventCategory[]} />;
}