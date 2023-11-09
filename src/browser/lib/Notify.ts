import Swal, { SweetAlertIcon } from 'sweetalert2';

const toast: ReturnType<typeof Swal.mixin> = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 7500,
  timerProgressBar: true,
  showClass: {
    popup: ''
  },
  hideClass: {
    popup: ''
  },
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer);
    toast.addEventListener('mouseleave', Swal.resumeTimer);
  }
});

export class Notify {
  static async send (icon: string, html: string) {
    const title = icon.charAt(0).toUpperCase() + icon.slice(1);
    await toast.fire({ html, title, icon: (icon as SweetAlertIcon) });
  }
}
