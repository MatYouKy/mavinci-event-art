export const uploadImage = async (file: File, path: string): Promise<string> => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('path', path);

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload/image`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  const data = await response.json();
  return data.url;
};

export const deleteImage = async (url: string): Promise<void> => {
  console.log('Delete image:', url);
};
