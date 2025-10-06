import { Slider as MuiSlider, SliderProps } from '@mui/material';
import React from 'react';

interface CustomSliderProps extends Omit<SliderProps, 'orientation'> {
  style?: React.CSSProperties;
}

export const SliderX: React.FC<CustomSliderProps> = ({ style, ...props }) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: '10%',
        right: '10%',
        bottom: 10,
        zIndex: 1500,
        ...style,
      }}
    >
      <MuiSlider
        {...props}
        orientation="horizontal"
        sx={{
          color: '#d3bb73',
          '& .MuiSlider-thumb': {
            backgroundColor: '#d3bb73',
          },
          '& .MuiSlider-track': {
            backgroundColor: '#d3bb73',
          },
          '& .MuiSlider-rail': {
            backgroundColor: '#e5e4e2',
            opacity: 0.3,
          },
        }}
      />
    </div>
  );
};

export const SliderY: React.FC<CustomSliderProps> = ({ style, ...props }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: '10%',
        bottom: '10%',
        right: 10,
        zIndex: 1500,
        ...style,
      }}
    >
      <MuiSlider
        {...props}
        orientation="vertical"
        sx={{
          color: '#d3bb73',
          '& .MuiSlider-thumb': {
            backgroundColor: '#d3bb73',
          },
          '& .MuiSlider-track': {
            backgroundColor: '#d3bb73',
          },
          '& .MuiSlider-rail': {
            backgroundColor: '#e5e4e2',
            opacity: 0.3,
          },
        }}
      />
    </div>
  );
};

export const SliderScale: React.FC<CustomSliderProps> = ({ style, ...props }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: '10%',
        bottom: '10%',
        left: 10,
        zIndex: 1500,
        ...style,
      }}
    >
      <MuiSlider
        {...props}
        orientation="vertical"
        sx={{
          color: '#d3bb73',
          '& .MuiSlider-thumb': {
            backgroundColor: '#d3bb73',
          },
          '& .MuiSlider-track': {
            backgroundColor: '#d3bb73',
          },
          '& .MuiSlider-rail': {
            backgroundColor: '#e5e4e2',
            opacity: 0.3,
          },
        }}
      />
    </div>
  );
};
