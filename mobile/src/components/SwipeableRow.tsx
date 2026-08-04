import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  GestureResponderEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, typography } from '../theme';

const DEFAULT_ACTION_WIDTH = 88;
const SWIPE_ACTIVATION_THRESHOLD = 8;
const SWIPE_DIRECTION_RATIO = 1.4;
const SWIPE_VELOCITY_THRESHOLD = 0.35;
const OVERSHOOT_RESISTANCE = 0.2;

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete: () => void;

  actionLabel?: string;
  actionIcon?: keyof typeof Feather.glyphMap;
  actionColor?: string;
  actionWidth?: number;
  disabled?: boolean;
}

export default function SwipeableRow({
  children,
  onDelete,
  actionLabel = 'Usuń',
  actionIcon = 'trash-2',
  actionColor = '#DC2626',
  actionWidth = DEFAULT_ACTION_WIDTH,
  disabled = false,
}: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;

  /**
   * Pozycja wiersza w chwili rozpoczęcia gestu.
   * Nie aktualizujemy jej podczas przesuwania.
   */
  const gestureStartXRef = useRef(0);

  /**
   * Aktualna faktyczna pozycja wiersza.
   */
  const currentXRef = useRef(0);

  const isOpenRef = useRef(false);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const listenerId = translateX.addListener(({ value }) => {
      currentXRef.current = value;
    });

    return () => {
      translateX.removeListener(listenerId);
      animationRef.current?.stop();
    };
  }, [translateX]);

  const stopAnimation = () => {
    animationRef.current?.stop();
    animationRef.current = null;
  };

  const animateTo = (toValue: number) => {
    stopAnimation();

    isDraggingRef.current = false;
    isOpenRef.current = toValue !== 0;

    const animation = Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      stiffness: 280,
      damping: 30,
      mass: 0.8,
      overshootClamping: true,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
    });

    animationRef.current = animation;

    animation.start(({ finished }) => {
      if (finished) {
        currentXRef.current = toValue;
      }

      if (animationRef.current === animation) {
        animationRef.current = null;
      }
    });
  };

  const close = () => {
    animateTo(0);
  };

  const open = () => {
    animateTo(-actionWidth);
  };

  const isHorizontalGesture = (gestureState: PanResponderGestureState) => {
    const absX = Math.abs(gestureState.dx);
    const absY = Math.abs(gestureState.dy);

    return (
      absX > SWIPE_ACTIVATION_THRESHOLD &&
      absX > absY * SWIPE_DIRECTION_RATIO
    );
  };

  const clampDragPosition = (position: number) => {
    /**
     * Nie pozwalamy przesuwać w prawo poza pozycję 0.
     */
    if (position > 0) {
      return position * OVERSHOOT_RESISTANCE;
    }

    /**
     * Po przekroczeniu szerokości przycisku dodajemy opór.
     */
    if (position < -actionWidth) {
      const overshoot = position + actionWidth;

      return -actionWidth + overshoot * OVERSHOOT_RESISTANCE;
    }

    return position;
  };

  const handleGrant = () => {
    stopAnimation();
    isDraggingRef.current = true;

    translateX.stopAnimation((value) => {
      gestureStartXRef.current = value;
      currentXRef.current = value;
    });
  };

  const handleMove = (
    _event: GestureResponderEvent,
    gestureState: PanResponderGestureState,
  ) => {
    const nextPosition = gestureStartXRef.current + gestureState.dx;
    const clampedPosition = clampDragPosition(nextPosition);

    translateX.setValue(clampedPosition);
  };

  const handleRelease = (
    _event: GestureResponderEvent,
    gestureState: PanResponderGestureState,
  ) => {
    isDraggingRef.current = false;

    const finalPosition = currentXRef.current;
    const draggedPastHalf = finalPosition <= -(actionWidth / 2);

    const fastSwipeLeft =
      gestureState.vx <= -SWIPE_VELOCITY_THRESHOLD;

    const fastSwipeRight =
      gestureState.vx >= SWIPE_VELOCITY_THRESHOLD;

    if (fastSwipeRight) {
      close();
      return;
    }

    if (fastSwipeLeft || draggedPastHalf) {
      open();
      return;
    }

    close();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,

        onMoveShouldSetPanResponder: (_event, gestureState) => {
          if (disabled) return false;

          return isHorizontalGesture(gestureState);
        },

        /**
         * Nie przechwytujemy gestu w fazie capture.
         * Dzięki temu TouchableOpacity wewnątrz działa stabilniej.
         */
        onMoveShouldSetPanResponderCapture: () => false,

        onPanResponderGrant: handleGrant,
        onPanResponderMove: handleMove,
        onPanResponderRelease: handleRelease,

        onPanResponderTerminate: () => {
          isDraggingRef.current = false;
          animateTo(isOpenRef.current ? -actionWidth : 0);
        },

        /**
         * Pozwala rodzicowi przejąć pionowe przewijanie FlatListy.
         */
        onPanResponderTerminationRequest: (_event, gestureState) => {
          return Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        },

        onShouldBlockNativeResponder: () => true,
      }),
    [actionWidth, disabled],
  );

  const handleActionPress = () => {
    close();
    onDelete();
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: actionColor,
        },
      ]}
    >
      <View
        style={[
          styles.actionBackground,
          {
            width: actionWidth,
            backgroundColor: actionColor,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.actionButton,
            {
              width: actionWidth,
            },
          ]}
          activeOpacity={0.8}
          onPress={handleActionPress}
        >
          <Feather
            name={actionIcon}
            size={20}
            color="#FFFFFF"
          />

          <Text style={styles.actionText}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      </View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.row,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },

  actionBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },

  actionButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },

  actionText: {
    color: '#FFFFFF',
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold as any,
  },

  row: {
    backgroundColor: colors.background.primary,
  },
});