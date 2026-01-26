'use server';

import { revalidateTag, revalidatePath } from 'next/cache';

export async function revalidateMessages() {
  revalidateTag('messages-list');
  revalidatePath('/crm/messages');
}

export async function revalidateEmailAccounts() {
  revalidateTag('email-accounts');
  revalidatePath('/crm/messages');
}
