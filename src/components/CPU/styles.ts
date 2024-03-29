import styled from 'styled-components';

export const Processor = styled.div`
    position: absolute;
    width: 56px;
    height: 56px;
    background-color: #222222;
    color: #ffffff;
    top: -28px;
    left: -28px;
    font-size: 15px;
    letter-spacing: 3px;
    font-weight: 700;
    font-family: 'Oxygen', Helvetica, arial, sans-serif;
    -webkit-animation: processor 3s infinite linear;
    animation: processor 3s infinite linear;
`;

// #processor {
//     position: absolute;
//     width: 56px;
//     height: 56px;
//     background-color: #222222;
//     color: #ffffff;
//     top: -28px;
//     left: -28px;
//     font-size: 15px;
//     letter-spacing: 3px;
//     font-weight: 700;
//     font-family: 'Oxygen', Helvetica, arial, sans-serif;
//     -webkit-animation: processor 3s infinite linear;
//     animation: processor 3s infinite linear;
//   }
//   #processor::before {
//     content: "llllll";
//     position: absolute;
//     width: 50px;
//     overflow: hidden;
//     text-shadow: -1px 0 0 #808080;
//     -webkit-transform: rotateZ(-90deg);
//     transform: rotateZ(-90deg);
//     -webkit-transform-origin: 0 0;
//     transform-origin: 0 0;
//     left: 45px;
//     bottom: -15px;
//     -webkit-animation: processor-before 3s infinite linear;
//     animation: processor-before 3s infinite linear;
//   }
//   #processor::after {
//     content: "llllll";
//     position: absolute;
//     width: 50px;
//     overflow: hidden;
//     text-shadow: -1px 0 0 #808080;
//     -webkit-transform: rotateZ(90deg) rotateY(180deg);
//     transform: rotateZ(90deg) rotateY(180deg);
//     -webkit-transform-origin: 0 0;
//     transform-origin: 0 0;
//     left: 10px;
//     top: 50px;
//     -webkit-animation: processor-after 3s infinite linear;
//     animation: processor-after 3s infinite linear;
//   }
//   @keyframes processor {
//     0% {
//       width: 0;
//       height: 0;
//       left: 0;
//       top: 0;
//     }
//     24% {
//       width: 0;
//       height: 0;
//       left: 0;
//       top: 0;
//     }
//     28% {
//       width: 56px;
//       height: 56px;
//       left: -28px;
//       top: -28px;
//     }
//   }
//   @keyframes processor-before {
//     0% {
//       width: 0;
//     }
//     32% {
//       width: 0;
//     }
//     44% {
//       width: 50px;
//     }
//   }
//   @keyframes processor-after {
//     0% {
//       width: 0;
//     }
//     44% {
//       width: 0;
//     }
//     56% {
//       width: 50px;
//     }
// }
