import React, { useEffect, useId, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { MotionConfig, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { AnimatedBackground } from './animated-background.jsx';

// Accessible Radix composition follows the shadcn/ui component patterns (MIT).
// Local styling is intentionally plain CSS; no application framework is added.
export function UiProvider({ children }) {
  return <MotionConfig reducedMotion="user"><TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={120}>{children}</TooltipPrimitive.Provider></MotionConfig>;
}

export function Tooltip({ children, content, side = 'top' }) {
  return <TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="ui-tooltip" side={side} sideOffset={7} collisionPadding={12}>{content}<TooltipPrimitive.Arrow className="ui-tooltip-arrow" /></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root>;
}

export function Dialog({ title, children, onClose, description, wide = false }) {
  const previousFocus = useRef(document.activeElement);
  const descriptionId = useId();
  const reducedMotion = useReducedMotion();
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay asChild><motion.div className="ui-dialog-overlay" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .16 }} /></DialogPrimitive.Overlay>
    <DialogPrimitive.Content asChild aria-describedby={description ? descriptionId : undefined} onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}>
      <motion.section className={`modal ui-dialog-content ${wide ? 'wide' : ''}`} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .16 }}>
        <header><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title><DialogPrimitive.Close asChild><button type="button" className="icon-button" aria-label="Close dialog"><X size={19} /></button></DialogPrimitive.Close></header>
        {description && <DialogPrimitive.Description id={descriptionId} className="modal-description">{description}</DialogPrimitive.Description>}{children}
      </motion.section>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal></DialogPrimitive.Root>;
}

// The active background uses Motion's shared layout transition. Its structure
// is adapted from Motion Primitives' Animated Background; see THIRD_PARTY_NOTICES.
export function ChoiceTabs({ value, onValueChange, options, label, className = '', listClassName = '', rightSlot, children, disabled = false }) {
  const tabItems = options.map(option => typeof option === 'string' ? { value: option, label: option } : option);
  return <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={`ui-tabs ${className}`}>
    <div className={`ui-tabs-toolbar ${rightSlot ? 'library-toolbar' : ''}`}>
      <TabsPrimitive.List className={`ui-tabs-list ${listClassName}`} aria-label={label}>
        <AnimatedBackground value={value} className="ui-tab-highlight">{tabItems.map(item => {
          return <TabsPrimitive.Trigger key={item.value} value={item.value} disabled={disabled || item.disabled} className={`ui-tab-trigger ${value === item.value ? 'selected' : ''}`}>
            {item.icon && <item.icon size={15} />}{item.label}
          </TabsPrimitive.Trigger>;
        })}</AnimatedBackground>
      </TabsPrimitive.List>{rightSlot}
    </div>
    {tabItems.map(item => <TabsPrimitive.Content key={item.value} forceMount hidden={value !== item.value} className="ui-tabs-panel" value={item.value} tabIndex={value === item.value ? 0 : -1}>{value === item.value ? children : null}</TabsPrimitive.Content>)}
  </TabsPrimitive.Root>;
}

export function ActionMenu({ children, label, items, align = 'end' }) {
  const trigger = useRef(null);
  const pendingDialog = useRef(null);
  return <DropdownPrimitive.Root><DropdownPrimitive.Trigger asChild ref={trigger}>{children}</DropdownPrimitive.Trigger><DropdownPrimitive.Portal><DropdownPrimitive.Content className="ui-menu" align={align} sideOffset={7} collisionPadding={12} aria-label={label} onCloseAutoFocus={event => {
    if (!pendingDialog.current) return;
    event.preventDefault();
    trigger.current?.focus();
    const openDialog = pendingDialog.current;
    pendingDialog.current = null;
    requestAnimationFrame(openDialog);
  }}>
    {items.map((item, index) => item.separator ? <DropdownPrimitive.Separator className="ui-menu-separator" key={`separator-${index}`} /> : <DropdownPrimitive.Item className={`ui-menu-item ${item.destructive ? 'is-destructive' : ''}`} disabled={item.disabled} key={item.id || item.label} onSelect={() => {
      // Wait for Radix's close lifecycle, then return focus before opening the
      // dialog. This avoids competing menu/dialog focus scopes and lost focus.
      if (item.opensDialog) pendingDialog.current = item.onSelect; else item.onSelect();
    }}>{item.icon && <item.icon size={15} />}<span>{item.label}</span>{item.trailing && <span className="ui-menu-trailing">{item.trailing}</span>}</DropdownPrimitive.Item>)}
  </DropdownPrimitive.Content></DropdownPrimitive.Portal></DropdownPrimitive.Root>;
}

export function RouteTransition({ route, children }) {
  const controls = useAnimationControls();
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) { controls.set({ opacity: 1 }); return; }
    controls.set({ opacity: .65 });
    void controls.start({ opacity: 1, transition: { duration: .18, ease: 'easeOut' } });
  }, [route, reducedMotion, controls]);
  // A stable wrapper animates only opacity. Never key/remount the audio owner,
  // preserve outgoing panels, delay captions, or wait for an exit animation.
  return <motion.div className="route-view" initial={false} animate={controls}>{children}</motion.div>;
}
