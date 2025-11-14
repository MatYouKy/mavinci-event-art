/* eslint-disable @typescript-eslint/no-unused-vars */
import { Button, LinkComponent, Loader, Typography } from '@components/UI';
import Logo from '@components/UI/Decorators/Event-Rulers/Logo';
import { useSignupUserMutation } from '@features/auth/api/auth.api';
import { useLandscape } from '@hooks/useLandscape';
import { useMobile } from '@hooks/useMobile';
import { useAppDispatch } from '@store/hooks';
import { snackbarAction } from '@store/slices/snackbarReducer';

import { AxiosError } from 'axios';
import { Formik, Form, Field, ErrorMessage } from 'formik';

import { useNavigate } from 'react-router-dom';

import * as Yup from 'yup';

const initialValues = {
  user_email: '',
  user_password: '',
  user_name: '',
};

const validationSchema = Yup.object({
  user_name: Yup.string()
    .min(6, 'Nieprawidłowe imię')
    .required('Imię jest wymagane'),
  user_email: Yup.string()
    .email('Nieprawidłowy email')
    .required('Email jest wymagany'),
  user_password: Yup.string()
    .min(6, 'Minimum 6 znaków')
    .required('Hasło jest wymagane'),
});

import { ISnackbar } from './auth.types';
import classes from './style.module.scss';

export const SigninPage = () => {
  const [registerUser, { isLoading, error }] = useSignupUserMutation();

  console.log('error', error);

  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isMobile = useMobile();
  const isLandscape = useLandscape();

  const onSubmit = async (values: typeof initialValues) => {
    try {
      const formData = new FormData();
      formData.append('user_email', values.user_email);
      formData.append('user_password', values.user_password);
      formData.append('user_name', values.user_name);

      const data = await registerUser(formData).unwrap();

      const { snackbar } = data;
      if (snackbar) {
        dispatch(snackbarAction(snackbar));
      }
      navigate('/');
    } catch (error) {
      if (error instanceof AxiosError) {
        dispatch(
          snackbarAction({
            status: 'ERROR',
            message: error.response?.data.message,
          })
        );
      }
    }
  };

  return (
    <article className={classes.login}>
      <div className={classes.background} />
      <div className={classes['login-wrapper']}>
        <div className={classes['login__logo']}>
          <Logo
            onClick={() => {
              return navigate('/');
            }}
            duration={0.5}
            delay={0.2}
            height={isMobile ? (isLandscape ? 80 : 160) : 300}
            width={300}
            color="--main-gold"
            aria-label="logo"
          />
        </div>
        <div className={classes['login-content']}>
          <Formik
            initialValues={initialValues}
            validationSchema={validationSchema}
            onSubmit={onSubmit}
          >
            <Form>
              <div>
                <label>Imię</label>
                <Field name="user_name" type="text" />
                <ErrorMessage name="user_name" component="div" />
              </div>
              <div>
                <label>Email</label>
                <Field name="user_email" type="email" />
                <ErrorMessage name="user_email" component="div" />
              </div>
              <div>
                <label>Hasło</label>
                <Field name="user_password" type="password" />
                <ErrorMessage name="user_password" component="div" />
              </div>

              <div className={classes.actions}>
                <div
                  style={{
                    minHeight: 24,
                    marginTop: 8,
                    width: '100%',
                  }}
                >
                  <Typography size="small" color="--cancel">
                    {
                      (error as { data?: { snackbar?: ISnackbar } })?.data
                        ?.snackbar?.message
                    }
                  </Typography>
                </div>
                {isLoading ? (
                  <Loader fullWidth />
                ) : (
                  <>
                    <Button
                      variant="outlined"
                      size="x-small"
                      type="submit"
                      color="--border-submit"
                    >
                      Zarejestruj
                    </Button>
                    <Typography
                      letterSpacing={1}
                      size="xx-small"
                      fontFamily="barlow-italic"
                    >
                      Masz konto w serwisie?{' '}
                      <LinkComponent
                        to="/admin/auth/login"
                        color="--main-gold"
                        fontFamily="barlow-italic-bold"
                        label="przejdz do zaloguj się"
                      >
                        Zaloguj się!
                      </LinkComponent>
                    </Typography>
                  </>
                )}
              </div>
            </Form>
          </Formik>
        </div>
      </div>
    </article>
  );
};

export default SigninPage;
