import * as React from 'react';
import { cn } from '@/lib/constants';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-huma-bdr bg-huma-bg3 px-3 py-1 text-xs text-huma-t placeholder:text-huma-t3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-huma-acc',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';
