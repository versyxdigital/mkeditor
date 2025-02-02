import Swal, { SweetAlertIcon } from 'sweetalert2';

/**
 * Configure a sweetalert2 mixin for toast notifications.
 */
const toast: ReturnType<typeof Swal.mixin> = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  showCloseButton: true,
  timer: 7500,
  timerProgressBar: true,
  showClass: {
    popup: '',
  },
  hideClass: {
    popup: '',
  },
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer);
    toast.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

export class Notify {
  /**
   * Send a toast notification.
   *
   * @param icon - the icon for the notification
   * @param html - the content of the notification
   */
  static async send(icon: string, html: string) {
    const title = icon.charAt(0).toUpperCase() + icon.slice(1);
    await toast.fire({ html, title, icon: icon as SweetAlertIcon });
  }
}
