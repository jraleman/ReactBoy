import styled from 'styled-components';

export const LogoImg = styled.img`
    height: 72px;
    position: relative;
    height: 15vmin;
    pointer-events: none;
`;

export const LogoContainer = styled.div`
`;

// TODO: Remove `!important` once we implement styles into styled-components fully
export const LogoText = styled.div`
    text-align: left !important;
    margin-left: 50px !important;
`;
  
// @media (prefers-reduced-motion: no-preference) {
//     .App-logo {
//       animation: App-logo-spin infinite 20s linear;
//     }
// }

// @keyframes App-logo-spin {
//     from {
//       transform: rotate(0deg);
//     }
//     to {
//       transform: rotate(360deg);
//     }
// }