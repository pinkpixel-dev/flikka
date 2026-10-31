import {createContext, useContext} from 'react';

// The error note at the top of the page, for any view: toast('…') shows it, toast('') hides it.
export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
