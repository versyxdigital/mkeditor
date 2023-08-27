import Swal from 'sweetalert2';

const notify = {};

notify.toast = Swal.mixin({
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 500000,
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

notify.send = async (icon, text, timer = 5000, position = 'bottom-end') => {
    const title = icon.charAt(0).toUpperCase() + icon.slice(1);
    await notify.toast.fire({
        icon,
        title,
        text,
        timer,
        position
    });
};

export default notify;
