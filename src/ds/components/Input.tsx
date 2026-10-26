import { forwardRef, type InputHTMLAttributes } from 'react';
/** Use inside Field or supply aria-label. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...props }, ref) { return <input {...props} ref={ref} className={`ds-input ${className}`} />; });
