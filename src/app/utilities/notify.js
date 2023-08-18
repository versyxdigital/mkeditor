import Swal from 'sweetalert2';

const notify = {};

notify.toast = Swal.mixin({
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 5000,
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

notify.send = async (type, msg, position = 'bottom-end') => {
    await notify.toast.fire({
        icon: type,
        title: type.charAt(0).toUpperCase() + type.slice(1),
        text: msg,
        position
    });
};

export default notify;
