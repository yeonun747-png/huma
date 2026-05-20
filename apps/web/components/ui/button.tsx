import * as React from 'react';
import { cn } from '@/lib/constants';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-huma-acc disabled:pointer-events-none disabled:opacity-50',
        variant === 'default' && 'bg-huma-acc text-white hover:opacity-90',
        variant === 'ghost' && 'border border-huma-bdr bg-transparent text-huma-t2 hover:bg-[var(--glow)] hover:text-huma-t',
        variant === 'destructive' && 'border border-huma-err bg-[var(--err-bg)] text-huma-err hover:bg-huma-err hover:text-white',
        variant === 'outline' && 'border border-huma-bdr bg-huma-bg3 text-huma-t2 hover:border-huma-acc',
        size === 'sm' && 'px-2 py-1 text-[10px]',
        size === 'md' && 'px-3 py-1.5 text-xs',
        size === 'lg' && 'px-4 py-2 text-sm',
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';
