import React, { Children, cloneElement, useId } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// Adapted from Motion Primitives Animated Background (MIT):
// https://github.com/ibelick/motion-primitives/blob/main/components/core/animated-background.tsx
// Source blob ae0a1ffc5b375ee59744089c83527cdbe6acec8b. Local adaptation uses the
// Radix Tabs controlled value so keyboard selection also moves the background.
// Full license and provenance are retained in THIRD_PARTY_NOTICES.md.
export function AnimatedBackground({ children, value, className = '' }) {
  const uniqueId = useId();
  const reducedMotion = useReducedMotion();
  return Children.map(children, child => cloneElement(child, {
    'data-checked': value === child.props.value ? 'true' : 'false',
  }, <>
    <AnimatePresence initial={false}>
      {value === child.props.value && <motion.span
        aria-hidden="true"
        layoutId={`background-${uniqueId}`}
        className={className}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: .2, ease: [0.22, 1, 0.36, 1] }}
      />}
    </AnimatePresence>
    <span className="ui-tab-label">{child.props.children}</span>
  </>));
}
